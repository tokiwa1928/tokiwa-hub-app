/**
 * FileMaker 中継（Tokiwa Hub → FileMaker Cloud Data API）
 *
 *   Hub の画面から FileMaker のデータを直接読み書きするための中継。
 *   データベースを二重に持たないので、同期ズレも二重更新の衝突も起きない。
 *
 *   Hub（ブラウザ）→ ここ（GAS）→ FileMaker Cloud Data API → トキワ印刷DB
 *
 * 安全のための決まりごと
 *   ・Google のサインインを必須にする。@tokiwap-group.com 以外は全部拒否する
 *   ・書き込めるのは「入力可の項目」だけ。計算フィールドと伝票番号は書けない
 *   ・書き込みには必ず modId を付ける。誰かが先に更新していたら FileMaker が弾く
 *   ・Claris の更新トークンはスクリプトプロパティに置く。コードには書かない
 *
 * スクリプトプロパティ（設置時に入れる）
 *   FM_REFRESH_TOKEN  Claris ID の更新トークン（有効1年）
 *   ALLOWED_DOMAIN    許すドメイン。複数あればカンマ区切り
 *                     例: tokiwap-group.com,tokiwap.co.jp
 *   LOG_SHEET_ID      （任意）書き込み記録を残すスプレッドシート
 *   WEB_CLIENT_ID     Hub のページから呼ぶときの Google OAuth クライアントID
 *                     （秘密ではない。入れておくと他サイト発行のトークンを弾ける）
 *   DEV_KEY           （任意）開発中だけ使う抜け道。実運用前に必ず消す
 */

var FM_HOST   = 'tokiwa.account.filemaker-cloud.com';
var FM_DB     = 'トキワ印刷DB';
var COGNITO   = 'https://cognito-idp.us-west-2.amazonaws.com/';
var CLIENT_ID = '4l9rvl4mv5es1eep1qe97cautn';

var LAYOUTS = {          // Hub の画面 → FileMaker のレイアウト
  juchu: 'Hub受注'
};

/**
 * 段階を写すときに使うレイアウト。
 *
 *   Hub受注（262項目）は「画面が使う項目」であって、金額を動かす入力を
 *   全部は含んでいない（箱数などが無く、写すと梱包代・配送代・印刷代が消えた）。
 *   複製用は 受注データ の入力項目 597 をすべて載せ、計算は1つも載せていない。
 *   計算が無いので速く（1件 0.17秒）、写しても取りこぼしが起きない。
 */
var COPY_LAYOUT = 'Hub受注_複製用';

var NEVER_WRITE = [];   // 計算フィールドは自動で除外される

/**
 * 段階と番号の決まりごと
 *
 *   新規レコードを作ると no が a108193 のように自動採番される。
 *   それをそのまま案件番号にする（既存の「受注データ新規作成」が
 *   伝票番号 = no としているのと同じ考え方）。
 *
 *     案件ID     a108193
 *     予算見積    見積番号 = a108193-YM01、2件目は -YM02
 *     見積       見積番号 = a108193-M01、 2件目は -M02
 *     受注       伝票番号 = a108193（＝案件ID。今までと同じ形）
 *     失注       番号はそのまま、案件区分だけ変える
 *
 *   見積レコードの no は空にする。受注化したときに
 *   「伝票番号 = no = 案件ID」という今までの形を保てるようにするため。
 *
 *   分割納品で既に使われている -A / -B とはぶつからない記号を選んである。
 */
var 段階 = {
  '予算見積': { 記号: 'YM', 欄: '見積番号' },
  '見積':    { 記号: 'M',  欄: '見積番号' },
  '受注':    { 記号: '',   欄: '伝票番号' },
  '失注':    { 記号: '',   欄: '' }
};

/** 見積は既存業務に出さない。伝票作成区分・納品書作成区分をこう置く */
var 段階の初期値 = {
  '予算見積': { '伝票作成区分': '予算見積', 'no': '' },
  '見積':    { '伝票作成区分': '見積',    'no': '' },
  '受注':    {},
  '失注':    { '伝票作成区分': '失注' }
};

var BASE = 'https://' + FM_HOST + '/fmi/data/vLatest/databases/' + encodeURIComponent(FM_DB);


// ------------------------------------------------------------------ 入口

function doPost(e) {
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var who = authorize_(req);
    いま呼んでいる人 = who;                 // 画面_* が Session を使わずに済むように
    try {
      var out = handle_(req.action, req, who);
    } finally {
      いま呼んでいる人 = null;
    }
    return json_({ ok: true, user: who.email, data: out });
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

/**
 * 画面を配信する。
 *   ここから配ると、社内アカウントでないとページ自体が開けない。
 *   合鍵も OAuth クライアントIDも要らず、CORS の問題も起きない。
 */
function doGet(e) {
  var screen = (e && e.parameter && e.parameter.screen) || 'juchu';
  var file = { juchu: 'juchu' }[screen];
  if (!file) return json_({ ok: true, note: '知らない画面です: ' + screen });

  var html = HtmlService.createHtmlOutputFromFile(file).getContent();

  // ?no=a108193 のように番号を渡せる。
  // HtmlService の画面は入れ子の枠で動くので、ページ側からは URL が見えない。
  // だから中に書き込んでおく。
  var no = (e && e.parameter && e.parameter.no) || '';
  if (no) {
    html += '\n<script>window.FM初期番号 = '
          + JSON.stringify(String(no)) + ';<\/script>';
  }

  return HtmlService.createHtmlOutput(html)
    .setTitle('受注入力（FileMaker）')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}


// ------------------------------------------------ 画面から呼ばれるもの

/** いま開いている人。組織内配信なので取得できる */
var いま呼んでいる人 = null;   // doPost が authorize_ の結果を入れる。1リクエストのあいだだけ

function 画面_利用者_() {
  if (いま呼んでいる人) return いま呼んでいる人;   // Hub のページから fetch で来た場合
  var mail = '';
  try { mail = Session.getActiveUser().getEmail() || ''; } catch (err) {}
  if (!mail) throw new Error('サインイン情報を取得できません。'
                             + '社内の Google アカウントで開いてください。');
  return { email: mail };
}

/** 一覧に出す列。ここに無いものは返さない（1件あたりを軽くするため） */
var 一覧の列 = [
  '伝票番号', '見積番号', '案件区分', '案件ID', '起票日', '納品日',
  '得意先コード', '担当者コード', '製品名', '品種',
  '合計数1', '売価金額', '合計金額', '注残数'
];

/**
 * 条件で探して一覧を返す。
 *   { キーワード, 得意先コード, 段階, 件数 }
 *   ・キーワードは製品名の部分一致
 *   ・段階は 案件区分（予算見積/見積/受注/失注）。空なら全部
 *   ・何も指定がなければ、起票日の新しい順に上から返す
 */
function 画面_一覧(条件) {
  var who = 画面_利用者_();
  var lay = LAYOUTS.juchu;
  条件 = 条件 || {};

  var 件数 = Number(条件['件数'] || 50);
  if (!(件数 > 0)) 件数 = 50;
  if (件数 > 200) 件数 = 200;   // 1件が重いので上限を切る

  var q = {};
  var キーワード = String(条件['キーワード'] || '').trim();
  var 得意先 = String(条件['得意先コード'] || '').trim();
  var 段階 = String(条件['段階'] || '').trim();

  if (キーワード) q['製品名'] = '*' + キーワード + '*';
  if (得意先)    q['得意先コード'] = '==' + 得意先;
  if (段階)      q['案件区分'] = '==' + 段階;

  var sort = [{ fieldName: '起票日', sortOrder: 'descend' }];
  var t0 = new Date();
  var rows;
  if (Object.keys(q).length) {
    rows = find_(lay, [q], 件数, 1, sort);
  } else {
    // 条件なしは _find が使えないので、レイアウトの先頭から取る
    var r = fmCall_('/layouts/' + encodeURIComponent(lay) + '/records'
                    + '?_limit=' + 件数 + '&_offset=1'
                    + '&_sort=' + encodeURIComponent(JSON.stringify(sort)));
    if (r.code !== '0') throw new Error('一覧の取得に失敗 (' + r.code + ') ' + r.message);
    rows = {
      total: (r.response.dataInfo || {}).foundCount || 0,
      records: (r.response.data || []).map(function (d) {
        return { recordId: d.recordId, modId: d.modId, fields: d.fieldData };
      })
    };
  }

  return {
    ok: true,
    user: who.email,
    件数: rows.records.length,
    全体: rows.total,
    ミリ秒: new Date() - t0,
    行: rows.records.map(function (r) {
      var o = { recordId: r.recordId };
      一覧の列.forEach(function (c) {
        if (r.fields[c] !== undefined) o[c] = r.fields[c];
      });
      return o;
    })
  };
}

/**
 * 番号で1件読む。伝票番号でも見積番号でも引ける。
 * 同じ案件の他の段階も一緒に返す（画面上部の履歴に出すため）。
 */
function 画面_読み込み(番号) {
  var who = 画面_利用者_();
  var lay = LAYOUTS.juchu;
  番号 = String(番号 || '').trim();
  if (!番号) throw new Error('番号を入れてください');

  var rows = find_(lay, [{ '伝票番号': '==' + 番号 }], 1, 1, null);
  if (!rows.records.length) rows = find_(lay, [{ '見積番号': '==' + 番号 }], 1, 1, null);
  var rec = rows.records[0] || null;

  return {
    ok: true,
    user: who.email,
    writable: fieldInfo_(lay).writable,
    record: rec,
    履歴: rec ? 案件の履歴_(lay, rec.fields['案件ID']) : []
  };
}

/** 同じ案件の段階を、古い順に並べて返す */
function 案件の履歴_(lay, 案件ID) {
  if (!案件ID) return [];
  var rows = find_(lay, [{ '案件ID': '==' + 案件ID }], 500, 1, null);
  return rows.records.map(function (r) {
    return {
      recordId: r.recordId,
      区分: r.fields['案件区分'] || '（従来の受注）',
      番号: r.fields['見積番号'] || r.fields['伝票番号'] || '',
      起票日: r.fields['起票日'] || '',
      合計金額: r.fields['合計金額'],
      売価金額: r.fields['売価金額']
    };
  }).sort(function (a, b) {
    if (a.起票日 !== b.起票日) return a.起票日 < b.起票日 ? -1 : 1;
    return Number(a.recordId) - Number(b.recordId);
  });
}

/** 履歴の1件を開く */
function 画面_recordIdで読む(recordId) {
  var who = 画面_利用者_();
  var lay = LAYOUTS.juchu;
  var r = fmCall_('/layouts/' + encodeURIComponent(lay) + '/records/' + recordId);
  if (r.code !== '0') throw new Error('読み込みに失敗 (' + r.code + ') ' + r.message);
  var d = (r.response.data || [])[0];
  if (!d) throw new Error('レコードが見つかりません');
  var rec = { recordId: d.recordId, modId: d.modId, fields: d.fieldData };
  return {
    ok: true, user: who.email,
    writable: fieldInfo_(lay).writable,
    record: rec,
    履歴: 案件の履歴_(lay, rec.fields['案件ID'])
  };
}

/** 画面で変わった分だけを書く */
function 画面_保存(recordId, modId, fields) {
  var who = 画面_利用者_();
  var r = update_(LAYOUTS.juchu, recordId, modId, fields, who);
  r.ok = true;
  return r;
}

/** 次の段階に引き継がないもの（番号・段階・進み具合・実績） */
var 引き継がない = [
  '伝票番号', '見積番号', '案件区分', '案件ID', 'no',
  '伝票作成区分', '納品書作成区分', '伝票チェック', '納品書チェック',
  '起票日', '納品日', '注残数'
];

/**
 * まっさらな案件を起こす。
 *   レコードを作ると no が自動採番されるので、それを案件番号にする。
 */
function 画面_新規案件(種別, 初期値) {
  var who = 画面_利用者_();
  var lay = LAYOUTS.juchu;
  if (!段階[種別]) throw new Error('知らない段階です: ' + 種別);

  var rec = 作成_(COPY_LAYOUT, 初期値 || {});
  var 案件ID = String(rec.fields['no'] || '');
  if (!案件ID) {
    削除_(lay, rec.recordId);
    throw new Error('番号が自動採番されませんでした。作成を取り消しました。');
  }
  var r = 番号と段階を入れる_(lay, rec, 案件ID, 種別, who);
  return { ok: true, 案件ID: 案件ID, record: r, 参考: null, 差分: [],
           writable: fieldInfo_(lay).writable, 履歴: 案件の履歴_(lay, 案件ID) };
}

/**
 * 既にある案件の、次の段階を起こす。
 *   ・内容は「その案件のいちばん新しい1件」から引き継ぐ（段階は問わない）
 *   ・前回の同じ段階を参考として返し、そこからの差分も返す
 *     （前年の予算見積の金額を見ながら、仕様の変化に気づけるように）
 */
function 画面_新規段階(案件ID, 種別) {
  var who = 画面_利用者_();
  var lay = LAYOUTS.juchu;
  if (!段階[種別]) throw new Error('知らない段階です: ' + 種別);
  if (!案件ID) throw new Error('案件IDがありません');

  var 種 = 最新_(lay, 案件ID);
  if (!種) throw new Error('案件 ' + 案件ID + ' が見つかりません');

  // 写しは複製用レイアウトで行う。画面用のレイアウトだと入力を取りこぼす
  var 種の全部 = getByDenpyo_複製用_(種);
  var 除く = {};
  引き継がない.forEach(function (n) { 除く[n] = true; });

  var base = {};
  Object.keys(種の全部).forEach(function (k) {
    if (除く[k]) return;
    var v = 種の全部[k];
    if (v === null || v === undefined || v === '') return;
    base[k] = String(v);
  });

  var rec = 作成_(COPY_LAYOUT, base);
  var r = 番号と段階を入れる_(lay, rec, 案件ID, 種別, who);

  var 参考 = 同じ段階の前回_(lay, 案件ID, 種別, rec.recordId);
  return {
    ok: true,
    案件ID: 案件ID,
    record: r,
    種: { recordId: 種.recordId, 区分: 種.fields['案件区分'] || '（従来の受注）',
          番号: 種.fields['伝票番号'] || 種.fields['見積番号'] || '',
          起票日: 種.fields['起票日'] || '' },
    参考: 参考 ? { recordId: 参考.recordId, 番号: 参考.fields['見積番号'] || 参考.fields['伝票番号'] || '',
                  起票日: 参考.fields['起票日'] || '',
                  合計金額: 参考.fields['合計金額'], 売価金額: 参考.fields['売価金額'] } : null,
    差分: 参考 ? 差分_(参考.fields, r.fields) : [],
    writable: fieldInfo_(lay).writable,
    履歴: 案件の履歴_(lay, 案件ID)
  };
}

/** 種レコードの入力項目を、複製用レイアウトから全部読む */
function getByDenpyo_複製用_(種) {
  var r = fmCall_('/layouts/' + encodeURIComponent(COPY_LAYOUT) + '/records/' + 種.recordId);
  if (r.code !== '0') throw new Error('複製用の読み取りに失敗 (' + r.code + ') ' + r.message);
  var d = (r.response.data || [])[0];
  if (!d) throw new Error('複製用に種レコードが見つかりません');
  return d.fieldData || {};
}

function 番号と段階を入れる_(lay, rec, 案件ID, 種別, who) {
  var upd = { '案件ID': 案件ID, '案件区分': 種別 };
  var def = 段階[種別];
  if (def.欄) upd[def.欄] = 次の番号_(lay, 案件ID, 種別);
  var ini = 段階の初期値[種別] || {};
  Object.keys(ini).forEach(function (k) { upd[k] = ini[k]; });

  var r = update_(lay, rec.recordId, rec.modId, upd, who);
  if (r.conflict) throw new Error('番号を入れる途中で衝突しました');
  return r;
}

function handle_(action, req, who) {
  switch (action) {
    case 'ping':   return { db: FM_DB, screens: Object.keys(LAYOUTS) };
    case 'fields': return fieldInfo_(layoutOf_(req.screen));
    case 'get':    return getByDenpyo_(layoutOf_(req.screen), req.denpyo);
    case 'find':   return find_(layoutOf_(req.screen), req.query, req.limit, req.offset, req.sort);
    case 'update': return update_(layoutOf_(req.screen), req.recordId, req.modId, req.fields, who);

    // 受注入力の画面から呼ぶもの。google.script.run と同じ中身を fetch でも使えるようにした
    case '画面_読み込み':     return 画面_読み込み(req['番号']);
    case '画面_recordIdで読む': return 画面_recordIdで読む(req.recordId);
    case '画面_保存':         return 画面_保存(req.recordId, req.modId, req.fields);
    case '画面_新規案件':     return 画面_新規案件(req['種別'], req['初期値']);
    case '画面_新規段階':     return 画面_新規段階(req['案件ID'], req['種別']);
    case '画面_一覧':         return 画面_一覧(req['条件']);
  }
  throw new Error('知らない action です: ' + action);
}

function layoutOf_(screen) {
  var lay = LAYOUTS[screen || 'juchu'];
  if (!lay) throw new Error('知らない画面です: ' + screen);
  return lay;
}


// ------------------------------------------------------- 誰が呼んだのか

/**
 * ブラウザから送られた Google の ID トークンを確かめ、社内の人かどうかを見る。
 * 社外・未サインインはここで全部止まる。
 */
function authorize_(req) {
  var props   = PropertiesService.getScriptProperties();
  var domains = (props.getProperty('ALLOWED_DOMAIN') || 'tokiwap-group.com,tokiwap.co.jp')
                  .split(',')
                  .map(function (d) { return d.trim().toLowerCase(); })
                  .filter(function (d) { return d; });

  var devKey = props.getProperty('DEV_KEY');
  if (devKey && req.devKey === devKey) {
    return { email: 'dev@' + domains[0], dev: true };   // 開発中だけの抜け道
  }

  if (!req.idToken) throw new Error('サインインが必要です');

  var res = UrlFetchApp.fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(req.idToken),
    { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('サインインを確認できませんでした');

  var info  = JSON.parse(res.getContentText());
  var email = String(info.email || '').toLowerCase();
  if (info.email_verified !== true && info.email_verified !== 'true') {
    throw new Error('メールアドレスが確認されていません');
  }
  // このトークンが本当に Hub の画面向けに出されたものかを見る。
  // これが無いと、社員が別サイトでもらったトークンでもここを通れてしまう。
  var web = props.getProperty('WEB_CLIENT_ID');
  if (web && String(info.aud || '') !== web) {
    throw new Error('この画面あてのサインインではありません');
  }
  var at = email.lastIndexOf('@');
  if (at < 0 || domains.indexOf(email.slice(at + 1)) < 0) {
    throw new Error('社内のアカウントでサインインしてください');
  }
  return { email: email };
}


// ------------------------------------------------------ FileMaker 接続

/** Claris の更新トークンから、1時間有効な ID トークンを得る（55分だけ使い回す） */
function fmIdToken_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('fm_id_token');
  if (hit) return hit;

  var refresh = PropertiesService.getScriptProperties().getProperty('FM_REFRESH_TOKEN');
  if (!refresh) throw new Error('FM_REFRESH_TOKEN が設定されていません');

  var res = UrlFetchApp.fetch(COGNITO, {
    method: 'post',
    contentType: 'application/x-amz-json-1.1',
    headers: { 'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth' },
    payload: JSON.stringify({
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      ClientId: CLIENT_ID,
      AuthParameters: { REFRESH_TOKEN: refresh }
    }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('Claris のトークンを更新できません（更新トークンの入れ直しが要ります）: '
                    + res.getContentText().slice(0, 200));
  }
  var tok = JSON.parse(res.getContentText()).AuthenticationResult.IdToken;
  cache.put('fm_id_token', tok, 3300);
  return tok;
}

/** Data API のセッション。FileMaker 側の無操作切れに備え、13分で作り直す */
function fmSession_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('fm_session');
  if (hit) return hit;

  var res = UrlFetchApp.fetch(BASE + '/sessions', {
    method: 'post', contentType: 'application/json',
    headers: { Authorization: 'FMID ' + fmIdToken_() },
    payload: '{}', muteHttpExceptions: true
  });
  var body = JSON.parse(res.getContentText());
  var msg  = (body.messages || [{}])[0];
  if (msg.code !== '0') throw new Error('FileMaker に接続できません (' + msg.code + ') ' + msg.message);

  var token = body.response.token;
  cache.put('fm_session', token, 780);
  return token;
}

/** Data API を呼ぶ。セッション切れ(952)なら一度だけ張り直して再試行する */
function fmCall_(path, method, payload) {
  for (var attempt = 0; attempt < 2; attempt++) {
    var opt = {
      method: method || 'get',
      headers: { Authorization: 'Bearer ' + fmSession_() },
      muteHttpExceptions: true
    };
    if (payload !== undefined) {
      opt.contentType = 'application/json';
      opt.payload = JSON.stringify(payload);
    }
    var res  = UrlFetchApp.fetch(BASE + path, opt);
    var body = JSON.parse(res.getContentText());
    var msg  = (body.messages || [{}])[0];
    if (msg.code === '952' && attempt === 0) {      // セッションが無効
      CacheService.getScriptCache().remove('fm_session');
      continue;
    }
    return { code: msg.code, message: msg.message, response: body.response || {} };
  }
}


// ------------------------------------------------------------ 読み書き

/** レイアウトの項目一覧。書ける項目と読むだけの項目を分けて返す */
function fieldInfo_(layout) {
  var key   = 'fields_' + layout;
  var cache = CacheService.getScriptCache();
  var hit   = cache.get(key);
  if (hit) return JSON.parse(hit);

  var r = fmCall_('/layouts/' + encodeURIComponent(layout));
  if (r.code !== '0') throw new Error('項目一覧を取れません (' + r.code + ') ' + r.message);

  var writable = [], readonly = [];
  (r.response.fieldMetaData || []).forEach(function (f) {
    if (f.result === 'container') return;
    var no = (f.type === 'calculation' || f.type === 'summary'
              || NEVER_WRITE.indexOf(f.name) >= 0);
    (no ? readonly : writable).push(f.name);
  });
  var out = { layout: layout, writable: writable, readonly: readonly };
  cache.put(key, JSON.stringify(out), 1800);
  return out;
}

function getByDenpyo_(layout, denpyo) {
  if (!denpyo) throw new Error('伝票番号がありません');
  var rows = find_(layout, [{ '伝票番号': '==' + denpyo }], 1, 1, null);
  return rows.records[0] || null;
}

function find_(layout, query, limit, offset, sort) {
  var body = {
    query:  (query && query.length) ? query : [{ '伝票番号': '*' }],
    limit:  String(limit || 20),
    offset: String(offset || 1)
  };
  if (sort) body.sort = sort;

  var r = fmCall_('/layouts/' + encodeURIComponent(layout) + '/_find', 'post', body);
  if (r.code === '401') return { total: 0, records: [] };      // 該当なし
  if (r.code !== '0') throw new Error('検索に失敗 (' + r.code + ') ' + r.message);

  return {
    total: (r.response.dataInfo || {}).foundCount || 0,
    records: (r.response.data || []).map(function (d) {
      return { recordId: d.recordId, modId: d.modId, fields: d.fieldData };
    })
  };
}

/**
 * 1件を更新する。
 *   ・書ける項目以外は黙って捨てる（画面から計算結果が送られてきても無視する）
 *   ・modId 必須。誰かが先に更新していたら FileMaker が 306 で弾く
 *   ・更新後の全項目を読み返して返す（金額の再計算結果を画面に戻すため）
 */
function update_(layout, recordId, modId, fields, who) {
  if (!recordId) throw new Error('recordId がありません');
  if (!modId)    throw new Error('modId がありません（先に読み込んでください）');
  if (!fields || !Object.keys(fields).length) throw new Error('書き込む内容がありません');

  var info = fieldInfo_(layout), allow = {};
  info.writable.forEach(function (n) { allow[n] = true; });

  var send = {}, ignored = [];
  Object.keys(fields).forEach(function (k) {
    if (allow[k]) send[k] = (fields[k] === null || fields[k] === undefined) ? '' : String(fields[k]);
    else ignored.push(k);
  });
  if (!Object.keys(send).length) {
    throw new Error('書ける項目がありませんでした（無視: ' + ignored.join('、') + '）');
  }

  var r = fmCall_('/layouts/' + encodeURIComponent(layout) + '/records/' + recordId,
                  'patch', { fieldData: send, modId: String(modId) });

  if (r.code === '306') {
    return { conflict: true,
             message: 'この伝票は、あなたが開いたあとに別の人が更新しています。'
                    + '画面を読み直してから、もう一度保存してください。' };
  }
  if (r.code !== '0') throw new Error('保存に失敗 (' + r.code + ') ' + r.message);

  var after = fmCall_('/layouts/' + encodeURIComponent(layout) + '/records/' + recordId);
  var rec   = (after.response.data || [])[0] || {};
  log_(who, layout, recordId, send);

  return { saved: Object.keys(send), ignored: ignored,
           recordId: recordId, modId: rec.modId, fields: rec.fieldData || {} };
}

// ------------------------------------------------------------ 段階と番号

function 桁揃え_(n, 桁) {
  var s = String(n);
  while (s.length < 桁) s = '0' + s;
  return s;
}

/**
 * その案件・その段階の次の番号を作る。
 *   予算見積 → a108193-YM01 / -YM02 …
 *   見積    → a108193-M01  / -M02  …
 *   受注・失注 → 案件ID そのもの
 */
function 次の番号_(layout, 案件ID, 種別) {
  var def = 段階[種別];
  if (!def) throw new Error('知らない段階です: ' + 種別);
  if (!def.記号) return 案件ID;

  var 既存 = find_(layout, [{ '案件ID': '==' + 案件ID, '案件区分': '==' + 種別 }], 500, 1, null);
  return 案件ID + '-' + def.記号 + 桁揃え_(既存.total + 1, 2);
}

/** レコードを1件作って、その内容を返す */
function 作成_(layout, fields) {
  var r = fmCall_('/layouts/' + encodeURIComponent(layout) + '/records', 'post',
                  { fieldData: fields || {} });
  if (r.code !== '0') throw new Error('作成に失敗 (' + r.code + ') ' + r.message);
  var id = r.response.recordId;
  // 読み返しは画面用のレイアウトで（金額の計算結果を返すため）
  var got = fmCall_('/layouts/' + encodeURIComponent(LAYOUTS.juchu) + '/records/' + id);
  var rec = (got.response.data || [])[0] || {};
  return { recordId: id, modId: rec.modId, fields: rec.fieldData || {} };
}

function 削除_(layout, recordId) {
  return fmCall_('/layouts/' + encodeURIComponent(layout) + '/records/' + recordId, 'delete');
}

/** 同じ案件のうち、いちばん新しい1件（段階は問わない） */
function 最新_(layout, 案件ID) {
  var rows = find_(layout, [{ '案件ID': '==' + 案件ID }], 500, 1, null);
  var best = null;
  rows.records.forEach(function (r) {
    if (!best) { best = r; return; }
    // 起票日 → recordId の順で新しい方を採る
    var a = String(r.fields['起票日'] || ''), b = String(best.fields['起票日'] || '');
    if (a > b || (a === b && Number(r.recordId) > Number(best.recordId))) best = r;
  });
  return best;
}

/** 同じ案件・同じ段階のうち、いちばん新しい1件（前年の予算見積などの参考用） */
function 同じ段階の前回_(layout, 案件ID, 種別, 除くRecordId) {
  var rows = find_(layout, [{ '案件ID': '==' + 案件ID, '案件区分': '==' + 種別 }], 500, 1, null);
  var best = null;
  rows.records.forEach(function (r) {
    if (除くRecordId && String(r.recordId) === String(除くRecordId)) return;
    if (!best) { best = r; return; }
    var a = String(r.fields['起票日'] || ''), b = String(best.fields['起票日'] || '');
    if (a > b || (a === b && Number(r.recordId) > Number(best.recordId))) best = r;
  });
  return best;
}

/** 2つのレコードで中身が違う項目を並べる（金額と仕様の変化を見せるため） */
function 差分_(前, 後) {
  var out = [];
  if (!前 || !後) return out;
  Object.keys(後).forEach(function (k) {
    var a = String(前[k] === undefined || 前[k] === null ? '' : 前[k]);
    var b = String(後[k] === undefined || 後[k] === null ? '' : 後[k]);
    if (a !== b) out.push({ 項目: k, 前: a, 後: b });
  });
  return out;
}

/** 誰がいつ何を書いたかを残す。スプレッドシートIDが無ければ何もしない */
function log_(who, layout, recordId, sent) {
  try {
    var id = PropertiesService.getScriptProperties().getProperty('LOG_SHEET_ID');
    if (!id) return;
    SpreadsheetApp.openById(id).getSheets()[0].appendRow(
      [new Date(), who.email, layout, recordId, Object.keys(sent).join('、'),
       JSON.stringify(sent).slice(0, 4000)]);
  } catch (e) { /* 記録に失敗しても本処理は止めない */ }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}


// ------------------------------------------------------------ 設置の確認

/**
 * ★ 設置したら、まずこの関数を1回実行してください ★
 *
 *   ・初回の実行で権限の承認画面が出ます。承認してください（これをしないと外から呼べません）
 *   ・スクリプトプロパティが正しいか、FileMaker につながるかをここで確かめます
 *   ・結果は「実行ログ」に出ます
 */
function セットアップ確認() {
  var props = PropertiesService.getScriptProperties();
  var log = [];

  function chk(name, hint) {
    var v = props.getProperty(name);
    log.push((v ? '○ ' : '× ') + name + ' : ' + (v ? '(' + v.length + '文字)' : hint));
    return v;
  }

  log.push('--- スクリプトプロパティ ---');
  var refresh = chk('FM_REFRESH_TOKEN', '未設定。更新トークンをコピー.cmd で取得して貼ってください');
  var domain  = props.getProperty('ALLOWED_DOMAIN');
  log.push((domain ? '○ ' : '△ ') + 'ALLOWED_DOMAIN : '
           + (domain || '未設定（既定の tokiwap-group.com,tokiwap.co.jp を使います）'));
  var web = props.getProperty('WEB_CLIENT_ID');
  log.push((web ? '○ ' : '△ ') + 'WEB_CLIENT_ID : '
           + (web || '未設定（Hub のページから呼ぶなら入れてください）'));
  var dev = props.getProperty('DEV_KEY');
  if (dev) log.push('⚠ DEV_KEY が設定されています。動作確認が済んだら必ず削除してください');
  var sheet = props.getProperty('LOG_SHEET_ID');
  log.push((sheet ? '○ ' : '－ ') + 'LOG_SHEET_ID : ' + (sheet || '未設定（書き込み記録は残しません）'));

  if (refresh) {
    log.push('');
    log.push('--- FileMaker ---');
    try {
      CacheService.getScriptCache().remove('fm_id_token');
      CacheService.getScriptCache().remove('fm_session');
      var t0 = new Date();
      fmIdToken_();
      log.push('○ Claris のトークン取得  ' + (new Date() - t0) + ' ミリ秒');

      t0 = new Date();
      fmSession_();
      log.push('○ Data API のセッション  ' + (new Date() - t0) + ' ミリ秒');

      t0 = new Date();
      var info = fieldInfo_(LAYOUTS.juchu);
      log.push('○ レイアウト ' + info.layout + '  ' + (new Date() - t0) + ' ミリ秒');
      log.push('   書ける項目 ' + info.writable.length + ' / 読むだけ ' + info.readonly.length);

      t0 = new Date();
      var n = find_(LAYOUTS.juchu, [{ '伝票番号': '*' }], 1, 1, null).total;
      log.push('○ 1件の検索  ' + (new Date() - t0) + ' ミリ秒（全 ' + n + ' 件）');
      log.push('');
      log.push('すべて通りました。中継は使える状態です。');
    } catch (e) {
      log.push('× ' + e.message);
    }
  }

  var text = log.join('\n');
  Logger.log(text);
  return text;
}


/**
 * ★ 書き込みまでの動作確認 ★
 *
 *   1件のレコードを借りて、次を順に確かめます。
 *     ・書ける項目だけが書かれ、計算フィールドは捨てられるか
 *     ・入力を書き換えると FileMaker 側で金額が計算し直されるか
 *     ・古い modId で送ったとき、二重更新として弾かれるか
 *   最後に必ず元へ戻し、全項目が変更前と一致することを確かめます。
 *
 *   借りるレコード: 伝票番号 a104362（内容の薄い古い伝票）
 *   借りる項目    : 注文書No（使用率0.5%の自由記入欄）と 用紙単価1
 */
function 動作確認_書き込みまで() {
  var DENPYO = 'a104362';
  var lay = LAYOUTS.juchu;
  var who = { email: 'setup-check' };
  var log = [];
  var ng = 0;
  function ok(cond, msg) { log.push((cond ? '○ ' : '× ') + msg); if (!cond) ng++; return cond; }

  var rec = getByDenpyo_(lay, DENPYO);
  if (!rec) { Logger.log('× 伝票 ' + DENPYO + ' が見つかりません'); return; }

  var before = {};
  Object.keys(rec.fields).forEach(function (k) { before[k] = rec.fields[k]; });
  log.push('対象 ' + DENPYO + '（recordId ' + rec.recordId + ' / modId ' + rec.modId
           + ' / 項目 ' + Object.keys(before).length + '）');
  log.push('');

  try {
    // ① 書ける項目だけが通るか。計算フィールドを混ぜて送ってみる
    var r1 = update_(lay, rec.recordId, rec.modId,
                     { '注文書No': 'HUBTEST', '合計金額': 999999 }, who);
    ok(!r1.conflict, '書き込めた');
    ok(r1.saved.indexOf('注文書No') >= 0, '注文書No は書けた');
    ok(r1.saved.indexOf('合計金額') < 0 && r1.ignored.indexOf('合計金額') >= 0,
       '合計金額（計算フィールド）は捨てられた');
    ok(r1.fields['注文書No'] === 'HUBTEST', '読み返して値が一致');

    // ② 古い modId で送ると弾かれるか
    var r2 = update_(lay, rec.recordId, rec.modId, { '注文書No': 'ZZZ' }, who);
    ok(r2.conflict === true, '古い modId は二重更新として弾かれた');

    // ③ 入力を書き換えると金額が計算し直されるか
    var r3 = update_(lay, rec.recordId, r1.modId, { '用紙単価1': '12.5' }, who);
    ok(!r3.conflict, '用紙単価1 を書けた');
    ok(String(r3.fields['用紙代1']) !== String(before['用紙代1']),
       '用紙代1 が計算し直された（' + before['用紙代1'] + ' → ' + r3.fields['用紙代1'] + '）');
    ok(String(r3.fields['合計金額']) !== String(before['合計金額']),
       '合計金額 が計算し直された（' + before['合計金額'] + ' → ' + r3.fields['合計金額'] + '）');

    // ④ 元へ戻す
    var back = update_(lay, rec.recordId, r3.modId,
                       { '注文書No': before['注文書No'] || '',
                         '用紙単価1': before['用紙単価1'] || '' }, who);
    var after = back.fields;
    var diff = [];
    Object.keys(before).forEach(function (k) {
      if (String(before[k]) !== String(after[k])) diff.push(k);
    });
    ok(diff.length === 0, '全 ' + Object.keys(before).length
       + ' 項目が変更前と一致' + (diff.length ? '（違い: ' + diff.join('、') + '）' : ''));
  } catch (e) {
    ng++;
    log.push('× 途中で失敗: ' + e.message);
    log.push('  ' + DENPYO + ' の状態を確認してください（変更前: 注文書No='
             + JSON.stringify(before['注文書No']) + ' 用紙単価1='
             + JSON.stringify(before['用紙単価1']) + '）');
  }

  log.push('');
  log.push(ng === 0 ? 'すべて通りました。書き込みも安全に使えます。'
                    : '× ' + ng + ' 件が想定どおりではありません。');
  var text = log.join('\n');
  Logger.log(text);
  return text;
}


/**
 * ★ 段階と番号の動作確認 ★
 *
 *   予算見積 → 見積 → 見積(2件目) → 受注 の順に4件作り、
 *   番号の付き方・既存業務から外れていること・差分が出ることを確かめ、
 *   最後に**作った4件を全部消す**。
 */
function 動作確認_段階と番号() {
  var lay = LAYOUTS.juchu;
  var log = [], ng = 0, 作った = [];
  function ok(cond, msg) { log.push((cond ? '○ ' : '× ') + msg); if (!cond) ng++; return cond; }

  try {
    var a = 画面_新規案件('予算見積', {
      '得意先コード': '47', '製品名': '【テスト】段階と番号', '用紙単価1': '2.5', '合計数1': '100'
    });
    作った.push(a.record.recordId);
    var id = a.案件ID;
    log.push('案件ID: ' + id);
    ok(a.record.fields['見積番号'] === id + '-YM01', '予算見積の番号 = ' + a.record.fields['見積番号']);
    ok(a.record.fields['no'] === '', '見積の no は空にした');
    ok(a.record.fields['伝票作成区分'] === '予算見積', '伝票作成区分 = 予算見積（受注伝票出力に出ない）');

    var b = 画面_新規段階(id, '見積');
    作った.push(b.record.recordId);
    ok(b.record.fields['見積番号'] === id + '-M01', '見積の番号 = ' + b.record.fields['見積番号']);
    ok(b.record.fields['製品名'] === '【テスト】段階と番号', '内容が引き継がれた');
    ok(b.record.fields['案件ID'] === id, '案件IDが揃っている');

    var c = 画面_新規段階(id, '見積');
    作った.push(c.record.recordId);
    ok(c.record.fields['見積番号'] === id + '-M02', '2件目の見積 = ' + c.record.fields['見積番号']);
    ok(c.参考 && String(c.参考.recordId) === String(b.record.recordId),
       '前回の同じ段階を参考として拾えた（' + (c.参考 ? c.参考.番号 : '—') + '）');

    // 仕様を変えてから受注を起こし、差分が出るか見る
    update_(lay, c.record.recordId, c.record.modId, { '用紙単価1': '9.9' }, { email: 'test' });
    var d = 画面_新規段階(id, '受注');
    作った.push(d.record.recordId);
    ok(d.record.fields['伝票番号'] === id, '受注の伝票番号 = 案件ID（' + d.record.fields['伝票番号'] + '）');
    ok(String(d.record.fields['用紙単価1']) === '9.9', '最新の内容（9.9）が引き継がれた');

    var 見積の差分 = 画面_新規段階(id, '予算見積');
    作った.push(見積の差分.record.recordId);
    var 変わった = (見積の差分.差分 || []).map(function (x) { return x.項目; });
    ok(変わった.indexOf('用紙単価1') >= 0,
       '前回の予算見積との差分に 用紙単価1 が出た（差分 ' + 変わった.length + ' 項目）');
    ok(変わった.indexOf('用紙代1') >= 0 || 変わった.indexOf('合計金額') >= 0,
       '金額の差分も出た');
  } catch (e) {
    ng++; log.push('× 途中で失敗: ' + e.message);
  } finally {
    var 消せた = 0;
    作った.forEach(function (id) { try { 削除_(lay, id); 消せた++; } catch (e) {} });
    log.push('');
    log.push('後片付け: 作った ' + 作った.length + ' 件のうち ' + 消せた + ' 件を削除');
    if (消せた !== 作った.length) { ng++; log.push('× 消し残しがあります。手で消してください'); }
  }

  log.push(ng === 0 ? '' : '');
  log.push(ng === 0 ? 'すべて通りました。' : '× ' + ng + ' 件が想定どおりではありません。');
  var text = log.join('\n');
  Logger.log(text);
  return text;
}
