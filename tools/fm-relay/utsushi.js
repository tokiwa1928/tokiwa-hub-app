/**
 * FileMaker の写し ── Hub 用の保管庫
 *
 *   FileMaker を止めたあとも Hub が全部のデータを持っていられるように、
 *   FileMaker の受注（Hub受注 レイアウト・全項目）を年ごとのスプレッドシートに写す。
 *
 *   置き場所（Drive）
 *     フォルダ  TokiwaHub_FileMaker写し
 *       ├ 受注_索引              全件1行ずつ・探すための最小限の列（伝票番号・起票日・得意先・製品名…）
 *       ├ 受注_2026              その年の全項目（1行＝1伝票、1列＝1項目）
 *       ├ 受注_2025
 *       └ …
 *
 *   1回の実行は 5 分で切り、続きは 1 分後のトリガーで自分を呼び直す。
 *   進み具合はスクリプトプロパティ 写し_進捗 に置く。
 *
 *   使い方（エディタから）
 *     写し_始める()     最初から写す（索引も年別も作り直す）
 *     写し_続ける()     途中から続ける（トリガーが自動で呼ぶ。手でも呼べる）
 *     写し_状況()       いまどこまで写したか
 *     写し_毎晩()       毎晩 2 時に「修正日が昨日以降」の分だけ写し直す（トリガー登録は 写し_毎晩を登録）
 */

var 写し = {
  フォルダ: 'TokiwaHub_FileMaker写し',
  索引名:   '受注_索引',
  年別名:   '受注_',
  索引の列: ['recordId', 'modId', '年', '伝票番号', '見積番号', '案件区分', '案件ID', '起票日', '納品日',
             '得意先コード', 'ユーザー名', '担当者コード', '製品名', '品種', '合計数1', '売価金額', '合計金額', '修正日'],
  ページ:   1000,         // 1回に FileMaker から読む件数
  制限秒:   330           // これを超えたら続きは次回に
};

// ------------------------------------------------------------ 置き場所

function 写し_フォルダ_() {
  var it = DriveApp.getFoldersByName(写し.フォルダ);
  return it.hasNext() ? it.next() : DriveApp.createFolder(写し.フォルダ);
}

function 写し_帳簿_(名, 見出し) {
  var f = 写し_フォルダ_();
  var it = f.getFilesByName(名);
  var ss;
  if (it.hasNext()) {
    ss = SpreadsheetApp.open(it.next());
  } else {
    ss = SpreadsheetApp.create(名);
    DriveApp.getFileById(ss.getId()).moveTo(f);
    var sh = ss.getSheets()[0];
    sh.setName('data');
    sh.getRange(1, 1, 1, 見出し.length).setValues([見出し]);
    sh.setFrozenRows(1);
  }
  return ss;
}

function 年_(起票日) {
  var m = /^(\d\d)\/(\d\d)\/(\d{4})$/.exec(String(起票日 || ''));
  return m ? m[3] : '不明';
}

// ------------------------------------------------------------ 進み具合

function 進捗_() {
  var p = PropertiesService.getScriptProperties().getProperty('写し_進捗');
  return p ? JSON.parse(p) : null;
}
function 進捗を書く_(o) {
  PropertiesService.getScriptProperties().setProperty('写し_進捗', JSON.stringify(o));
}

/** 最初から。索引と年別を空にして、offset 1 から */
function 写し_始める(合図) {
  // 誤って押すと保管庫（73k件・約70分）を捨ててやり直しになる。合図 'やり直す' を付けたときだけ動く
  if (合図 !== 'やり直す') { Logger.log('写し_始める は保管庫を捨ててやり直します。本当に必要なら 写し_始める("やり直す") と書いて実行してください'); return; }
  トリガーを外す_('写し_続ける');
  var f = 写し_フォルダ_();
  var it = f.getFiles();
  while (it.hasNext()) { var file = it.next(); if (file.getName().indexOf('受注_') === 0) file.setTrashed(true); }
  進捗を書く_({ offset: 1, 済: 0, 全体: null, 列: null, 始めた: new Date().toISOString(), 状態: '進行中' });
  Logger.log('写しを最初から始めます');
  return 写し_続ける();
}

/** 途中から。時間が来たら次回のトリガーを仕掛けて抜ける */
function 写し_続ける() {
  var t0 = Date.now();
  var p = 進捗_();
  if (!p || p.状態 === '完了') { Logger.log('進行中の写しはありません（写し_始める を先に）'); return; }

  var lay = LAYOUTS.juchu;
  var 索引 = 写し_帳簿_(写し.索引名, 写し.索引の列);
  var 索引sh = 索引.getSheets()[0];
  var 年別 = {};   // 年 → { ss, sh, 列 }

  while (Date.now() - t0 < 写し.制限秒 * 1000) {
    var r = fmCall_('/layouts/' + encodeURIComponent(lay) + '/records'
                    + '?_offset=' + p.offset + '&_limit=' + 写し.ページ
                    + '&_sort=' + encodeURIComponent(JSON.stringify([{ fieldName: '伝票番号', sortOrder: 'ascend' }])));
    if (r.code === '401') { p.状態 = '完了'; break; }        // これ以上ない
    if (r.code !== '0') throw new Error('FileMaker から読めません (' + r.code + ') ' + r.message);
    var data = r.response.data || [];
    if (!p.全体) p.全体 = (r.response.dataInfo || {}).totalRecordCount || (r.response.dataInfo || {}).foundCount || null;
    if (!data.length) { p.状態 = '完了'; break; }

    // 列の並びは最初の1件で決めて固定する
    if (!p.列) {
      p.列 = ['recordId', 'modId'].concat(Object.keys(data[0].fieldData).sort());
    }

    var 索引行 = [], 年行 = {};
    data.forEach(function (d) {
      var f = d.fieldData, y = 年_(f['起票日']);
      var row = p.列.map(function (c) {
        if (c === 'recordId') return d.recordId;
        if (c === 'modId') return d.modId;
        var v = f[c]; return (v === undefined || v === null) ? '' : v;
      });
      (年行[y] = 年行[y] || []).push(row);
      索引行.push(写し.索引の列.map(function (c) {
        if (c === 'recordId') return d.recordId;
        if (c === 'modId') return d.modId;
        if (c === '年') return y;
        var v = f[c]; return (v === undefined || v === null) ? '' : v;
      }));
    });

    // 年別へ
    Object.keys(年行).forEach(function (y) {
      if (!年別[y]) {
        var ss = 写し_帳簿_(写し.年別名 + y, p.列);
        年別[y] = { sh: ss.getSheets()[0] };
      }
      var sh = 年別[y].sh, rows = 年行[y];
      sh.getRange(sh.getLastRow() + 1, 1, rows.length, p.列.length).setValues(rows);
    });
    // 索引へ
    索引sh.getRange(索引sh.getLastRow() + 1, 1, 索引行.length, 写し.索引の列.length).setValues(索引行);

    p.offset += data.length;
    p.済 += data.length;
    進捗を書く_(p);
    Logger.log('写した: ' + p.済 + (p.全体 ? ' / ' + p.全体 : '') + '（' + Math.round((Date.now() - t0) / 1000) + '秒）');
    if (data.length < 写し.ページ) { p.状態 = '完了'; break; }
  }

  if (p.状態 === '完了') {
    索引キャッシュを捨てる_();
    p.終わった = new Date().toISOString();
    進捗を書く_(p);
    トリガーを外す_('写し_続ける');
    Logger.log('写しが終わりました: ' + p.済 + ' 件');
  } else {
    進捗を書く_(p);
    トリガーを外す_('写し_続ける');
    ScriptApp.newTrigger('写し_続ける').timeBased().after(60 * 1000).create();
    Logger.log('時間なので一旦止めます。1分後に続きます（' + p.済 + ' 件まで）');
  }
  return p;
}

function 写し_状況() {
  var p = 進捗_();
  var s = p ? (p.状態 + '　' + p.済 + (p.全体 ? ' / ' + p.全体 : '') + ' 件　offset ' + p.offset
               + '　始め ' + p.始めた + (p.終わった ? '　終わり ' + p.終わった : ''))
            : 'まだ始めていません';
  Logger.log(s);
  return s;
}

function トリガーを外す_(fn) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === fn) ScriptApp.deleteTrigger(t);
  });
}

// ------------------------------------------------------------ 毎晩の差分

/** 修正日が昨日以降のものを写し直す（索引・年別の該当行を置き換える） */
function 写し_毎晩() {
  var lay = LAYOUTS.juchu;
  var d = new Date(); d.setDate(d.getDate() - 1);
  var 昨日 = 日付_(d);
  var rows = find_(lay, [{ '修正日': '>=' + 昨日 }], 2000, 1, null);
  if (!rows.records.length) { Logger.log('昨日以降の修正はありません'); return 0; }

  var p = 進捗_(); if (!p || !p.列) throw new Error('先に 写し_始める で写しを作ってください');
  var 索引 = 写し_帳簿_(写し.索引名, 写し.索引の列).getSheets()[0];
  var 索引値 = 索引.getDataRange().getValues();
  var 索引位置 = {}; for (var i = 1; i < 索引値.length; i++) 索引位置[String(索引値[i][0])] = i + 1;
  var 年別 = {};

  var 更新 = 0, 追加 = 0;
  rows.records.forEach(function (rec) {
    var f = rec.fields, y = 年_(f['起票日']);
    if (!年別[y]) {
      var sh = 写し_帳簿_(写し.年別名 + y, p.列).getSheets()[0];
      var ids = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), 1).getValues();
      var pos = {}; for (var j = 1; j < ids.length; j++) pos[String(ids[j][0])] = j + 1;
      年別[y] = { sh: sh, pos: pos };
    }
    var row = p.列.map(function (c) {
      if (c === 'recordId') return rec.recordId;
      if (c === 'modId') return rec.modId;
      var v = f[c]; return (v === undefined || v === null) ? '' : v;
    });
    var 索引行 = 写し.索引の列.map(function (c) {
      if (c === 'recordId') return rec.recordId;
      if (c === 'modId') return rec.modId;
      if (c === '年') return y;
      var v = f[c]; return (v === undefined || v === null) ? '' : v;
    });
    var Y = 年別[y], at = Y.pos[String(rec.recordId)];
    if (at) { Y.sh.getRange(at, 1, 1, row.length).setValues([row]); 更新++; }
    else { Y.sh.appendRow(row); Y.pos[String(rec.recordId)] = Y.sh.getLastRow(); 追加++; }
    var ai = 索引位置[String(rec.recordId)];
    if (ai) 索引.getRange(ai, 1, 1, 索引行.length).setValues([索引行]);
    else { 索引.appendRow(索引行); 索引位置[String(rec.recordId)] = 索引.getLastRow(); }
  });
  索引キャッシュを捨てる_(); 写し_索引_();   // 索引の json を作り直しておく（朝一番の人を待たせない）
  Logger.log('毎晩の写し: 更新 ' + 更新 + '・追加 ' + 追加 + '（修正日 ' + 昨日 + ' 以降 ' + rows.records.length + ' 件）');
  return rows.records.length;
}

function 写し_毎晩を登録() {
  トリガーを外す_('写し_毎晩');
  ScriptApp.newTrigger('写し_毎晩').timeBased().atHour(2).everyDays(1).create();
  Logger.log('毎晩 2 時に 写し_毎晩 を動かします');
}

// ============================================================ 写しを読む（Hub から）
//   FileMaker を止めたあとは、ここが「読む」の本体になる。
//   画面は FileMaker（ライブ）と同じ形で結果を受け取るので、切り替えても画面は変わらない。

var 写し帳簿キャッシュ_ = {};
function 写し_開く_(名, 見出し) {
  if (写し帳簿キャッシュ_[名]) return 写し帳簿キャッシュ_[名];
  var f = 写し_フォルダ_(); var it = f.getFilesByName(名);
  if (!it.hasNext()) throw new Error('写しがまだありません: ' + 名);
  return (写し帳簿キャッシュ_[名] = SpreadsheetApp.open(it.next()).getSheets()[0]);
}

/** スプレッドシートが日付に解釈してしまった値を、FileMaker と同じ MM/dd/yyyy の文字に戻す */
function 値を整える_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Tokyo', 'MM/dd/yyyy');
  return v;
}

/**
 * 索引を全部読む（73k行×18列）。
 * シートから読むと 10 秒以上かかるので、読んだ結果を 受注_索引.json として同じフォルダに置き、次からはそれを読む（1〜2秒）。
 * 写し直したら 索引キャッシュを捨てる_ で json を消す（次に読んだ人が作り直す。毎晩の写しは自分で作り直す）。
 */
var 索引JSON名 = '受注_索引.json';
function 写し_索引_() {
  var f = 写し_フォルダ_();
  var it = f.getFilesByName(索引JSON名);
  if (it.hasNext()) {
    try {
      var j = JSON.parse(it.next().getBlob().getDataAsString('UTF-8'));
      var 列 = j.列, out = [];
      for (var r = 0; r < j.行.length; r++) { var o = {}, row = j.行[r]; for (var c = 0; c < 列.length; c++) o[列[c]] = row[c]; out.push(o); }
      return out;
    } catch (e) { /* 壊れていたらシートから読み直す */ }
  }
  var sh = 写し_開く_(写し.索引名);
  var v = sh.getDataRange().getValues();
  var 見出し = v[0], rows = [], objs = [];
  for (var i = 1; i < v.length; i++) {
    var row = [], o = {};
    for (var k = 0; k < 見出し.length; k++) { var x = 値を整える_(v[i][k]); row.push(x); o[見出し[k]] = x; }
    rows.push(row); objs.push(o);
  }
  try {
    索引キャッシュを捨てる_();
    f.createFile(索引JSON名, JSON.stringify({ 列: 見出し, 行: rows, 作った: new Date().toISOString() }), 'application/json');
  } catch (e) { /* 置けなくても動く */ }
  return objs;
}
function 索引キャッシュを捨てる_() {
  var it = 写し_フォルダ_().getFilesByName(索引JSON名);
  while (it.hasNext()) it.next().setTrashed(true);
}

function 写し_日付数_(v) {   // MM/DD/YYYY → 20260911 のような数（比較用）
  var m = /^(\d\d)\/(\d\d)\/(\d{4})$/.exec(String(v || '')); return m ? Number(m[3] + m[1] + m[2]) : 0;
}

/** 画面_一覧 と同じ条件・同じ返り値で、写しから探す */
function 写し_一覧(条件) {
  var who = 画面_利用者_(); 条件 = 条件 || {};
  var t0 = new Date();
  var 件数 = Number(条件['件数'] || 50); if (!(件数 > 0)) 件数 = 50; if (件数 > 200) 件数 = 200;
  var kw = String(条件['キーワード'] || '').trim();
  var cust = String(条件['得意先コード'] || '').trim();
  var 段階 = String(条件['段階'] || '').trim();
  var 日数 = Number(条件['日数']); if (isNaN(日数)) 日数 = 90;
  var から = 0;
  if (日数 > 0) { var d = new Date(); d.setDate(d.getDate() - 日数); から = Number(Utilities.formatDate(d, 'Asia/Tokyo', 'yyyyMMdd')); }

  var rows = 写し_索引_().filter(function (r) {
    if (kw && String(r['製品名'] || '').indexOf(kw) < 0) return false;
    if (cust && String(r['得意先コード'] || '') !== cust) return false;
    if (段階 && String(r['案件区分'] || '') !== 段階) return false;
    if (から && 写し_日付数_(r['起票日']) < から) return false;
    return true;
  });
  rows.sort(function (a, b) { return 写し_日付数_(b['起票日']) - 写し_日付数_(a['起票日']) || (Number(b.recordId) - Number(a.recordId)); });
  var 全体 = rows.length; rows = rows.slice(0, 件数);
  return { ok: true, user: who.email, 件数: rows.length, 全体: 全体, 日数: 日数, ミリ秒: new Date() - t0, 源: '写し',
           行: rows.map(function (r) { var o = { recordId: String(r.recordId) }; 一覧の列.forEach(function (c) { if (r[c] !== undefined) o[c] = r[c]; }); return o; }) };
}

/** 画面_読み込み と同じ返り値で、写しから1件読む（伝票番号でも見積番号でも） */
function 写し_読み込み(番号) {
  var who = 画面_利用者_(); 番号 = String(番号 || '').trim();
  if (!番号) throw new Error('番号を入れてください');
  var hit = 写し_索引_().filter(function (r) { return String(r['伝票番号']) === 番号 || String(r['見積番号']) === 番号; })[0];
  if (!hit) return { ok: true, user: who.email, record: null, 履歴: [], 源: '写し' };
  var rec = 写し_行を読む_(hit['年'], hit.recordId);
  return { ok: true, user: who.email, writable: [], record: rec, 源: '写し',
           履歴: rec ? 案件の履歴_写し_(rec.fields['案件ID']) : [] };
}

function 写し_行を読む_(年, recordId) {
  var sh = 写し_開く_(写し.年別名 + 年);
  var 見出し = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var ids = sh.getRange(1, 1, sh.getLastRow(), 1).getValues();
  for (var i = 1; i < ids.length; i++) {
    if (String(ids[i][0]) === String(recordId)) {
      var v = sh.getRange(i + 1, 1, 1, 見出し.length).getValues()[0];
      var f = {}; for (var c = 2; c < 見出し.length; c++) f[見出し[c]] = 値を整える_(v[c]);
      return { recordId: String(v[0]), modId: String(v[1]), fields: f };
    }
  }
  return null;
}

function 案件の履歴_写し_(案件ID) {
  if (!案件ID) return [];
  return 写し_索引_().filter(function (r) { return String(r['案件ID']) === String(案件ID); }).map(function (r) {
    return { recordId: String(r.recordId), 区分: r['案件区分'] || '（従来の受注）', 番号: r['見積番号'] || r['伝票番号'] || '',
             起票日: r['起票日'] || '', 合計金額: r['合計金額'], 売価金額: r['売価金額'] };
  }).sort(function (a, b) { return 写し_日付数_(a.起票日) - 写し_日付数_(b.起票日) || (Number(a.recordId) - Number(b.recordId)); });
}

// ============================================================ GEN のデータも同じ保管庫へ
//   Hub のページ（gen-import.html）が GEN の Excel を読んで、ここに行を送る。
//   画面ごとに1枚のスプレッドシート（GEN_受注・GEN_発注・…）。鍵で上書きするので何度送っても二重にならない。

var GEN帳簿名_ = 'GEN_';

/** 行を受け取り、鍵で上書きしながら保管する。{画面, 見出し, 鍵列（見出しの中の列名の配列）, 行:[{...}]} */
function GEN_取り込み(画面, 見出し, 鍵列, 行) {
  var who = 画面_利用者_();
  return GEN_取り込み_中_(画面, 見出し, 鍵列, 行, who.email);
}

/**
 * 中身。行は {列名: 値} でも、見出しと同じ並びの配列でもよい。
 * 保管庫の列が違っても消さず、列の和にして持つ（列が増えたら右に足す）。
 */
function GEN_取り込み_中_(画面, 見出し, 鍵列, 行, 誰) {
  if (!画面 || !見出し || !見出し.length || !行) throw new Error('画面・見出し・行が要ります');
  var 名 = GEN帳簿名_ + 画面;
  var ss = 写し_帳簿_(名, ['_鍵', '_取込日時', '_取込者'].concat(見出し));
  var sh = ss.getSheets()[0];
  var 既 = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String) : [];
  var 頭 = 既.length ? 既.slice() : ['_鍵', '_取込日時', '_取込者'];
  見出し.forEach(function (c) { if (頭.indexOf(c) < 0) 頭.push(c); });
  if (頭.length !== 既.length) { sh.getRange(1, 1, 1, 頭.length).setValues([頭]); sh.setFrozenRows(1); }
  var 位置列 = {}; 頭.forEach(function (c, i) { 位置列[c] = i; });
  var 見出し位置 = {}; 見出し.forEach(function (c, i) { 見出し位置[c] = i; });

  function 値(r, c) { var v = Array.isArray(r) ? r[見出し位置[c]] : r[c]; return (v === undefined || v === null) ? '' : v; }
  var 鍵を作る = function (r) { return (鍵列 || [見出し[0]]).map(function (c) { return String(値(r, c)); }).join('|'); };
  var 位置 = {};
  if (sh.getLastRow() > 1) {
    var keys = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < keys.length; i++) 位置[String(keys[i][0])] = i + 2;
  }
  var now = new Date().toISOString(), 更新 = 0, 追加 = [], 更新行 = [];
  行.forEach(function (r) {
    var k = 鍵を作る(r); if (!k.replace(/\|/g, '')) return;
    var row = new Array(頭.length); for (var i = 0; i < 頭.length; i++) row[i] = '';
    row[0] = k; row[1] = now; row[2] = 誰;
    見出し.forEach(function (c) { row[位置列[c]] = 値(r, c); });
    var at = 位置[k];
    if (at > 0) { 更新行.push([at, row]); 更新++; }
    else if (at < 0) { 追加[-at - 1] = row; }                 // 同じファイルの中で鍵が重なった → 後の行で置き換え
    else { 追加.push(row); 位置[k] = -追加.length; }
  });
  // 更新は 1 行ずつ（数は少ない想定）。連続していればまとめる
  更新行.sort(function (x, y) { return x[0] - y[0]; });
  for (var u = 0; u < 更新行.length;) {
    var start = 更新行[u][0], block = [更新行[u][1]]; var v = u + 1;
    while (v < 更新行.length && 更新行[v][0] === start + block.length) { block.push(更新行[v][1]); v++; }
    sh.getRange(start, 1, block.length, 頭.length).setValues(block); u = v;
  }
  // 追加は 2,000 行ずつ
  for (var p = 0; p < 追加.length; p += 2000) {
    var part = 追加.slice(p, p + 2000);
    sh.getRange(sh.getLastRow() + 1, 1, part.length, 頭.length).setValues(part);
  }
  return { ok: true, 画面: 画面, 更新: 更新, 追加: 追加.length, 全体: sh.getLastRow() - 1 };
}

/**
 * Drive の保管庫フォルダに置いた GEN取込_<画面>.json（gen_csv_to_json.py の出力）を読んで保管庫に入れる。
 * 1ファイル入れるごとに「済_」を頭に付けて名前を変える。時間が来たら途中で抜けるので、残っていればもう一度実行。
 */
function GEN_ファイルから取り込む() {
  var t0 = Date.now(), f = 写し_フォルダ_(), it = f.getFiles(), files = [];
  while (it.hasNext()) { var x = it.next(); if (/^GEN取込_.+\.json$/.test(x.getName())) files.push(x); }
  files.sort(function (a, b) { return a.getSize() - b.getSize(); });   // 小さいものから
  if (!files.length) { Logger.log('GEN取込_*.json がありません'); return; }
  files.forEach(function (file) {
    if (Date.now() - t0 > 270 * 1000) { Logger.log('時間なので止めます。もう一度実行してください（残り: ' + file.getName() + ' …）'); return; }
    var j = JSON.parse(file.getBlob().getDataAsString('UTF-8'));
    var r = GEN_取り込み_中_(j.画面, j.見出し, j.鍵列, j.行, 'ファイル取込 ' + file.getName());
    file.setName('済_' + file.getName());
    Logger.log(j.画面 + ': 追加 ' + r.追加 + '・更新 ' + r.更新 + '・全体 ' + r.全体 + '（' + Math.round((Date.now() - t0) / 1000) + '秒）');
  });
}

/** 保管してある GEN の画面を読む。{画面, 絞り込み:{列名:値}, 件数} */
function GEN_一覧(画面, 絞り込み, 件数) {
  var who = 画面_利用者_();
  var sh = 写し_開く_(GEN帳簿名_ + 画面);
  var v = sh.getDataRange().getValues(); if (v.length < 2) return { ok: true, 画面: 画面, 件数: 0, 全体: 0, 行: [] };
  var 頭 = v[0]; var out = [];
  for (var i = 1; i < v.length; i++) {
    var o = {}; for (var c = 3; c < 頭.length; c++) { var x = v[i][c]; o[頭[c]] = (x instanceof Date) ? Utilities.formatDate(x, 'Asia/Tokyo', 'yyyy-MM-dd') : x; }
    var ok = true;
    if (絞り込み) Object.keys(絞り込み).forEach(function (k) { var want = String(絞り込み[k] || '').trim(); if (want && String(o[k] || '').indexOf(want) < 0) ok = false; });
    if (ok) out.push(o);
  }
  var 全体 = out.length;
  件数 = (件数 === 0 || 件数 === '0') ? 0 : Number(件数 || 500);   // 0 は「全部」
  if (件数 > 0) out = out.slice(0, 件数);
  return { ok: true, user: who.email, 画面: 画面, 件数: out.length, 全体: 全体, 行: out };
}

/** 保管してある GEN の画面ごとの件数 */
function GEN_状況() {
  var f = 写し_フォルダ_(); var it = f.getFiles(); var out = {};
  while (it.hasNext()) { var file = it.next(); var n = file.getName(); if (n.indexOf(GEN帳簿名_) === 0) { var sh = SpreadsheetApp.open(file).getSheets()[0]; out[n.slice(GEN帳簿名_.length)] = Math.max(0, sh.getLastRow() - 1); } }
  return { ok: true, 画面: out };
}

/** エディタから実行して、写しの読みを確かめる（結果はログに出る） */
function 検証_写し読み() {
  いま呼んでいる人 = { mail: 'editor@test', name: 'エディタからの検証' };
  var t = Date.now();
  var a = 写し_一覧({ 得意先コード: 'N0052', 日数: 365, 件数: 3 });
  Logger.log('一覧 N0052 直近1年: ' + (Date.now() - t) + 'ms 全体 ' + a.全体 + ' 先頭 ' + JSON.stringify(a.行[0] || null));
  t = Date.now();
  var b = 写し_一覧({ キーワード: 'カレンダー', 日数: 0, 件数: 3 });
  Logger.log('一覧 カレンダー 全期間: ' + (Date.now() - t) + 'ms 全体 ' + b.全体 + ' 先頭 ' + JSON.stringify(b.行[0] || null));
  t = Date.now();
  var c = 写し_読み込み('a108167'); var f = (c.record || {}).fields || {};
  Logger.log('読込 a108167: ' + (Date.now() - t) + 'ms 項目数 ' + Object.keys(f).length + ' 起票日 ' + f['起票日'] + ' 納期 ' + f['納期'] + ' 得意先コード ' + JSON.stringify(f['得意先コード']) + ' 履歴 ' + c.履歴.length);
}
