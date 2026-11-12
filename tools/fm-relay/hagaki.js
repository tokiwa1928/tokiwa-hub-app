// HAGAKI-1（2026-11-12 本多さん「北上プリントの年賀状・喪中はがきの案件を、ファイルメーカーから自動で Drive に転記できる？」）
//   FileMaker の受注から 北上プリント（得意先コード 5463）の 年賀・喪中・寒中 の伝票と、その官製はがき（同じ番号の -A など）を探し、
//   Drive の「北上プリント喪中はがき・年賀状案件管理表（北上→トキワ）」の「はがき案件一覧」へ 伝票番号ごとに書く。
//   ・あれば上書き（起票日〜納期の列だけ。項番と備考は触らない）、無ければ下に足す（項番は続き）
//   ・毎晩の写し（写し_毎晩）の最初に動く。毎時にしたいときは 北上はがき_毎時を登録 を一度動かす（Hub の「はがき案件の転記」画面のボタン）
//   ・対象は 今シーズン（9/1 以降の起票。1〜5 月に動かしたときは前の年の 9/1 から）

var 北上はがき = {
  表ID: '1EwZkSzyKOUELRULI7ukP66DOD5htwhi6JbczYLD3ZWs',   // 北上プリント喪中はがき・年賀状案件管理表（北上→トキワ）
  シート名: 'はがき案件一覧',
  得意先コード: '5463',
  得意先名: '有限会社北上プリント',
  語: ['年賀', '喪中', '寒中'],
  見出し: ['項番', '起票日', '伝票番号', '得意先名', 'エンドユーザー', '品名（製品名）', '数量', '単位', '売価単価', '売価金額', '納期', '備考']
};

function 北上はがき_期首_() {
  var d = new Date(), y = d.getFullYear(); if (d.getMonth() + 1 < 6) y--;
  return '09/01/' + y;
}
function 北上はがき_日_(v) {   // FileMaker の MM/DD/YYYY → YYYY-MM-DD
  var m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(v || '')); if (!m) return String(v || '');
  return m[3] + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2);
}
function 北上はがき_数_(v) { if (v === '' || v == null) return ''; var n = Number(String(v).replace(/[,，¥円\s]/g, '')); return isNaN(n) ? String(v) : n; }

/** FileMaker から今シーズンの対象伝票を集める */
function 北上はがき_集める_() {
  var lay = LAYOUTS.juchu, 期首 = 北上はがき_期首_(), cd = '==' + 北上はがき.得意先コード;
  var q = 北上はがき.語.map(function (w) { return { '得意先コード': cd, '製品名': '*' + w + '*', '起票日': '>=' + 期首 }; });
  q.push({ '得意先コード': cd, '製品名': '*官製*', '起票日': '>=' + 期首 });
  q.push({ '得意先コード': cd, '製品名': '*はがき*', '起票日': '>=' + 期首 });
  q.push({ '得意先コード': cd, '製品名': '*ハガキ*', '起票日': '>=' + 期首 });
  var all = [], off = 1;
  while (true) {
    var r = find_(lay, q, 500, off, [{ fieldName: '伝票番号', sortOrder: 'ascend' }]);
    all = all.concat(r.records); if (r.records.length < 500 || all.length >= r.total) break; off += 500;
  }
  var 語 = new RegExp(北上はがき.語.join('|'));
  var 本体 = {}; all.forEach(function (x) { var f = x.fields; if (語.test(String(f['製品名'] || ''))) 本体[String(f['伝票番号'] || '').replace(/-[A-Z]+$/i, '')] = 1; });
  // 年賀・喪中・寒中 そのもの ＋ その伝票の官製はがき（-A など同じ番号）
  return all.filter(function (x) { var f = x.fields, no = String(f['伝票番号'] || ''); return 語.test(String(f['製品名'] || '')) || 本体[no.replace(/-[A-Z]+$/i, '')]; });
}

/** 転記する。返す: { 足した, 直した, 同じ, 対象, 表 } */
function 北上はがき_同期() {
  var lock = LockService.getScriptLock(); if (!lock.tryLock(20000)) throw new Error('ほかの転記が動いています');
  try {
    var recs = 北上はがき_集める_();
    var ss = SpreadsheetApp.openById(北上はがき.表ID), sh = ss.getSheetByName(北上はがき.シート名) || ss.getSheets()[0];
    var last = Math.max(1, sh.getLastRow()), W = 北上はがき.見出し.length;
    var v = last > 1 ? sh.getRange(2, 1, last - 1, W).getValues() : [];
    var 行 = {}, 項番max = 0;
    v.forEach(function (r, i) { var no = String(r[2] || '').trim(); if (no) 行[no] = i + 2; var n = Number(r[0]); if (!isNaN(n) && n > 項番max) 項番max = n; });
    var 足す = [], 直した = 0, 同じ = 0;
    recs.sort(function (a, b) { var x = 北上はがき_日_(a.fields['起票日']), y = 北上はがき_日_(b.fields['起票日']); return x < y ? -1 : x > y ? 1 : String(a.fields['伝票番号']) < String(b.fields['伝票番号']) ? -1 : 1; });
    recs.forEach(function (x) {
      var f = x.fields, no = String(f['伝票番号'] || '').trim(); if (!no) return;
      var 数量 = f['ロット契約単位'] !== '' && f['ロット契約単位'] != null ? f['ロット契約単位'] : f['合計数1'];
      var 中 = [北上はがき_日_(f['起票日']), no, 北上はがき.得意先名, String(f['ユーザー名'] || ''), String(f['製品名'] || ''), 北上はがき_数_(数量), String(f['単位'] || ''), 北上はがき_数_(f['売価単価']), 北上はがき_数_(f['売価金額']), 北上はがき_日_(f['納期'])];
      if (行[no]) {
        var rr = 行[no], now = v[rr - 2].slice(1, 11).map(function (c) { return c instanceof Date ? Utilities.formatDate(c, 'Asia/Tokyo', 'yyyy-MM-dd') : c; });
        var 違う = 中.some(function (c, i) { return String(c) !== String(now[i]); });
        if (違う) { sh.getRange(rr, 2, 1, 10).setValues([中]); 直した++; } else 同じ++;
      } else { 項番max++; 足す.push([項番max].concat(中).concat([''])); }
    });
    if (足す.length) {
      var start = sh.getLastRow() + 1; sh.getRange(start, 1, 足す.length, W).setValues(足す);
      try { if (start > 2) sh.getRange(2, 1, 1, W).copyTo(sh.getRange(start, 1, 足す.length, W), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false); } catch (e) {}
    }
    var 結果 = { ok: true, 足した: 足す.length, 直した: 直した, 同じ: 同じ, 対象: recs.length, 表: ss.getUrl(), 時刻: new Date().toISOString() };
    PropertiesService.getScriptProperties().setProperty('北上はがき_最後', JSON.stringify(結果));
    return 結果;
  } finally { lock.releaseLock(); }
}

/** 毎時の自動転記を入れる／外す */
function 北上はがき_毎時を登録(外す) {
  トリガーを外す_('北上はがき_同期');
  if (!外す) ScriptApp.newTrigger('北上はがき_同期').timeBased().everyHours(1).create();
  return { ok: true, 毎時: !外す };
}

/** 画面（Hub）から: 今すぐ転記／状態／毎時の入り切り */
function 北上はがき_画面(する) {
  var who = 画面_利用者_();
  if (する === '今すぐ') { var r = 北上はがき_同期(); r.user = who.email; return r; }
  if (する === '毎時オン') return 北上はがき_毎時を登録(false);
  if (する === '毎時オフ') return 北上はがき_毎時を登録(true);
  var 毎時 = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === '北上はがき_同期'; });
  var 最後 = null; try { 最後 = JSON.parse(PropertiesService.getScriptProperties().getProperty('北上はがき_最後') || 'null'); } catch (e) {}
  return { ok: true, user: who.email, 毎時: 毎時, 最後: 最後, 表: 'https://docs.google.com/spreadsheets/d/' + 北上はがき.表ID + '/edit' };
}
