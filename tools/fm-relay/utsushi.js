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
  ページ:   500,          // 1回に FileMaker から読む件数
  制限秒:   280           // これを超えたら続きは次回に
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
function 写し_始める() {
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
  Logger.log('毎晩の写し: 更新 ' + 更新 + '・追加 ' + 追加 + '（修正日 ' + 昨日 + ' 以降 ' + rows.records.length + ' 件）');
  return rows.records.length;
}

function 写し_毎晩を登録() {
  トリガーを外す_('写し_毎晩');
  ScriptApp.newTrigger('写し_毎晩').timeBased().atHour(2).everyDays(1).create();
  Logger.log('毎晩 2 時に 写し_毎晩 を動かします');
}
