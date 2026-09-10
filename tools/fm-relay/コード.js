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
 *   DEV_KEY           （任意）開発中だけ使う抜け道。実運用前に必ず消す
 */

var FM_HOST   = 'tokiwa.account.filemaker-cloud.com';
var FM_DB     = 'トキワ印刷DB';
var COGNITO   = 'https://cognito-idp.us-west-2.amazonaws.com/';
var CLIENT_ID = '4l9rvl4mv5es1eep1qe97cautn';

var LAYOUTS = {          // Hub の画面 → FileMaker のレイアウト
  juchu: 'Hub受注'
};

var NEVER_WRITE = ['伝票番号'];   // 計算フィールドは自動で除外。これは追加の禁止

var BASE = 'https://' + FM_HOST + '/fmi/data/vLatest/databases/' + encodeURIComponent(FM_DB);


// ------------------------------------------------------------------ 入口

function doPost(e) {
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var who = authorize_(req);
    var out = handle_(req.action, req, who);
    return json_({ ok: true, user: who.email, data: out });
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

function doGet() {
  return json_({ ok: true, note: 'FileMaker 中継。POST で使ってください。' });
}

function handle_(action, req, who) {
  switch (action) {
    case 'ping':   return { db: FM_DB, screens: Object.keys(LAYOUTS) };
    case 'fields': return fieldInfo_(layoutOf_(req.screen));
    case 'get':    return getByDenpyo_(layoutOf_(req.screen), req.denpyo);
    case 'find':   return find_(layoutOf_(req.screen), req.query, req.limit, req.offset, req.sort);
    case 'update': return update_(layoutOf_(req.screen), req.recordId, req.modId, req.fields, who);
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
