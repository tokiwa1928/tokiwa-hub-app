/**
 * HUBMITSU-1（本多さん 9/29）: 予算見積・見積は FileMaker に入れず、Hub の保管庫（写しフォルダの「見積」シート）に置く。
 *
 *   FileMaker には受注だけ。受注の前（予算見積・見積）は、支給ファイルも含めて Hub に取っておき、
 *   受注したら「受注化」で FileMaker に受注伝票を起こす。
 *
 *   番号:  P番号-YM01（予算見積）／ P番号-M01（見積）。P番号は Hub の案件番号（案件フォルダと同じ）
 *   状態:  見積中 → 提出済 →（採用＝受注化 ／ 失注 ／ 保留）
 *   画面（受注入力・見積入力・見積書）からは今までどおり 画面_読み込み／画面_保存／画面_新規案件… で扱える。
 *   番号の形（P0042-M01）で FileMaker か Hub かを振り分ける。recordId は 'hub:P0042-M01'
 */
var 見積列 = ['番号', 'P番号', '種別', '状態', '起票日', '修正日', '得意先コード', '得意先', '製品名', '数量', '売価金額', '合計金額', '担当者コード', 'json', 'by', 'at', '受注伝票番号', '元', '問い合わせID', '案件名'];
var 見積_固定 = ['見積番号', '伝票番号', '案件区分', '案件ID', 'P番号', '状態', '受注伝票番号', '修正日', '修正者', '作成者', '作成日', 'recordId', 'modId', 'no'];

function 見積_帳簿_() { return 写し_帳簿_('見積', 見積列).getSheets()[0]; }
function Hub番号か_(no) { return /^P\d{3,}-(YM|M)\d{2,}$/i.test(String(no || '').trim()); }
function HubP番号か_(id) { return /^P\d{3,}$/i.test(String(id || '').trim()); }
function HubのrecordIdか_(id) { return /^hub:/i.test(String(id || '')); }
function 見積_今日_() { return Utilities.formatDate(new Date(), 'Asia/Tokyo', 'MM/dd/yyyy'); }
function 見積_P正規_(p) { var n = Number(String(p || '').replace(/^P/i, '')); return n ? 'P' + 桁揃え_(n, 4) : ''; }

function 見積_行_(v, i) { var o = {}; 見積列.forEach(function (c, j) { var x = v[i][j]; o[c] = (x instanceof Date) ? x.toISOString() : (x == null ? '' : x); }); o._row = i + 1; return o; }
function 見積_全部_() {
  var sh = 見積_帳簿_(); var v = sh.getDataRange().getValues(); var out = [];
  for (var i = 1; i < v.length; i++) { if (!String(v[i][0] || '')) continue; out.push(見積_行_(v, i)); }
  return out;
}
function 見積_探す_(no) {
  no = String(no || '').trim().toUpperCase(); if (!no) return null;
  var sh = 見積_帳簿_(); var v = sh.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) if (String(v[i][0]).toUpperCase() === no) return 見積_行_(v, i);
  return null;
}
function 見積_P番号の一番新しい_(P番号) {
  P番号 = 見積_P正規_(P番号); var best = null;   // 一番新しい＝起票日が新しい、同じ日なら後に起こした方（at は修正日時なので使わない）
  var key = function (x) { var m = /^(\d\d)\/(\d\d)\/(\d{4})$/.exec(String(x['起票日'] || '')); return m ? Number(m[3] + m[1] + m[2]) : 0; };
  見積_全部_().forEach(function (x) { if (見積_P正規_(x['P番号']) !== P番号 || String(x['状態']) === '削除') return; if (!best || key(x) > key(best) || (key(x) === key(best) && x._row > best._row)) best = x; });
  return best;
}
function 見積_json_(o) { var j = {}; try { j = JSON.parse(o.json || '{}') || {}; } catch (e) { j = {}; } return j; }
function 見積_fields_(o) {
  var f = 見積_json_(o);
  f['見積番号'] = String(o['番号']); f['伝票番号'] = ''; f['案件区分'] = String(o['種別']); f['案件ID'] = String(o['P番号']); f['P番号'] = String(o['P番号']);
  f['起票日'] = String(o['起票日'] || ''); f['修正日'] = String(o['修正日'] || ''); f['作成日'] = f['作成日'] || String(o['起票日'] || '');
  f['状態'] = String(o['状態'] || ''); f['受注伝票番号'] = String(o['受注伝票番号'] || ''); f['修正者'] = String(o.by || ''); f['作成者'] = f['作成者'] || String(o.by || '');
  f['問い合わせID'] = String(o['問い合わせID'] || ''); f['案件名'] = String(o['案件名'] || '');
  return f;
}
function 見積_record_(o) { return { recordId: 'hub:' + o['番号'], modId: String(o.at || ''), fields: 見積_fields_(o) }; }
function 見積_書く_(o) {
  var sh = 見積_帳簿_(); var j = 見積_json_(o);
  o['得意先コード'] = j['得意先コード'] || o['得意先コード'] || ''; o['製品名'] = j['製品名'] || ''; o['数量'] = j['ロット契約単位'] || j['合計数1'] || '';
  o['売価金額'] = j['売価金額'] || ''; o['合計金額'] = j['合計金額'] || ''; o['担当者コード'] = j['担当者コード'] || '';
  var row = 見積列.map(function (c) { return o[c] == null ? '' : o[c]; });
  if (o._row) sh.getRange(o._row, 1, 1, 見積列.length).setValues([row]); else { sh.appendRow(row); o._row = sh.getLastRow(); }
}

/** 同じ P番号の段階を古い順に（履歴欄）。受注化したものは FileMaker の受注も並べる */
function 見積_履歴_(P番号) {
  P番号 = 見積_P正規_(P番号); var out = [];
  見積_全部_().forEach(function (x) {
    if (見積_P正規_(x['P番号']) !== P番号 || String(x['状態']) === '削除') return;
    var st = String(x['状態'] || ''); out.push({ recordId: 'hub:' + x['番号'], 区分: x['種別'] + (st && st !== '見積中' ? '（' + st + '）' : ''), 番号: x['番号'], 起票日: x['起票日'], 合計金額: x['合計金額'], 売価金額: x['売価金額'], at: String(x.at) });
    if (x['受注伝票番号']) out.push({ recordId: 'no:' + x['受注伝票番号'], 区分: '受注', 番号: x['受注伝票番号'], 起票日: '', 合計金額: '', 売価金額: '', at: String(x.at) + '~' });
  });
  out.sort(function (a, b) { return a.at < b.at ? -1 : 1; });
  return out;
}
function 見積_返す_(o, who) {
  var writable = null; try { writable = fieldInfo_(LAYOUTS.juchu).writable; } catch (e) {}
  var r = { ok: true, user: who.email, 案件ID: String(o['P番号']), record: 見積_record_(o), 参考: null, 差分: [], writable: writable, 履歴: 見積_履歴_(o['P番号']), hub: true };
  if (o['元']) r.種 = { 番号: String(o['元']) };   // 画面が 手配（事前情報・用紙・外注）を元から写す手がかり
  return r;
}

/** 画面_読み込み の Hub 版。番号（P0042-M01）か P番号（P0042 → 一番新しい段階） */
function 見積_読み込み_(番号) {
  var who = 画面_利用者_(); 番号 = String(番号 || '').trim();
  var o = HubP番号か_(番号) ? 見積_P番号の一番新しい_(番号) : 見積_探す_(番号);
  if (!o || String(o['状態']) === '削除') return { ok: true, user: who.email, record: null, 履歴: [], hub: true };
  var r = 見積_返す_(o, who); var rec = r.record; var lay = LAYOUTS.juchu;
  // YOY-2 と同じ: 同じ P番号で、この番号より前に起こした 1 つ下の段階との差分
  var 順 = { '予算見積': 1, '見積': 2 }; r.前段階 = null; r.前段階差分 = [];
  try {
    var mine = 順[String(o['種別'])] || 0, best = null;
    見積_全部_().forEach(function (x) { if (見積_P正規_(x['P番号']) !== 見積_P正規_(o['P番号']) || String(x['番号']) === String(o['番号']) || String(x['状態']) === '削除') return; var k = 順[String(x['種別'])] || 0; if (!k || k >= mine) return; if (!best || String(x.at) > String(best.at)) best = x; });
    if (best) { r.前段階 = { recordId: 'hub:' + best['番号'], 番号: best['番号'], 起票日: best['起票日'], 区分: best['種別'] }; r.前段階差分 = 差分_(見積_fields_(best), rec.fields); }
  } catch (e) {}
  // COST-1 と同じ: 前回伝票番号（FileMaker の受注）の原価内訳
  r.前回原価 = null;
  try {
    var pno = String(rec.fields['前回伝票番号'] || '').trim();
    if (pno) { var f1 = find_(lay, [{ '伝票番号': '==' + pno }], 1, 1, null); var pv = f1.records[0];
      if (pv) { r.前回原価 = {}; ['伝票番号', '起票日', '売価金額', '売価単価', '合計数1', '用紙代', '印刷代', '加工賃', '人件費', '梱包代', '版代', '配送代', '合計金額', '用紙単価1', '紙質1', '品名1'].forEach(function (c) { r.前回原価[c] = pv.fields[c] === undefined ? '' : pv.fields[c]; }); } }
  } catch (e) { r.前回原価 = null; }
  return r;
}

/** 画面_保存 の Hub 版。別の人が先に保存していても、同じ項目を触っていなければ重ねる */
function 見積_保存_(番号, modId, fields, 元, 強制) {
  var who = 画面_利用者_(); if (!fields || !Object.keys(fields).length) throw new Error('書き込む内容がありません');
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    var o = 見積_探す_(番号); if (!o) throw new Error(番号 + ' が見積の保管庫にありません');
    var 今 = 見積_fields_(o); var 合流 = !!(modId && String(o.at) !== String(modId));
    if (合流 && !強制) {
      var 衝突 = {};
      if (元) Object.keys(fields).forEach(function (k) { if (!(k in 元)) return; if (String(今[k] == null ? '' : 今[k]) !== String(元[k] == null ? '' : 元[k])) 衝突[k] = { 相手: 今[k], あなた: fields[k] }; });
      if (Object.keys(衝突).length) return { ok: true, conflict: true, 衝突: 衝突, recordId: 'hub:' + o['番号'], modId: String(o.at), fields: 今, message: '同じ項目を別の人も直しています: ' + Object.keys(衝突).join('、') };
    }
    var j = 見積_json_(o); var saved = [], ignored = [], 前 = {};
    Object.keys(fields).forEach(function (k) { if (見積_固定.indexOf(k) >= 0) { ignored.push(k); return; } 前[k] = j[k]; j[k] = (fields[k] === null || fields[k] === undefined) ? '' : String(fields[k]); saved.push(k); });
    if (!saved.length) throw new Error('書ける項目がありませんでした（無視: ' + ignored.join('、') + '）');
    o.json = JSON.stringify(j); o['修正日'] = 見積_今日_(); o.by = who.email; o.at = new Date().toISOString();
    見積_書く_(o); log_(who, 'Hub見積', 'hub:' + o['番号'], fields, 前);
    var rec = 見積_record_(o);
    return { ok: true, saved: saved, ignored: ignored, recordId: rec.recordId, modId: rec.modId, fields: rec.fields, 合流: 合流 };
  } finally { lock.releaseLock(); }
}

// ------------------------------------------------------------ 番号
function 見積_次のP番号_(ヒント) {
  var props = PropertiesService.getScriptProperties(); var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    var n = Number(props.getProperty('見積_P番号') || 0);
    見積_全部_().forEach(function (x) { var m = Number(String(x['P番号'] || '').replace(/^P/i, '')) || 0; if (m > n) n = m; });
    var h = Number(String(ヒント || '').replace(/^P/i, '')) || 0; if (h > n) n = h;
    n += 1; props.setProperty('見積_P番号', String(n)); return 'P' + 桁揃え_(n, 4);
  } finally { lock.releaseLock(); }
}
/** Hub 本体が P番号を付けたら知らせてもらう（同じ番号を二度使わないため） */
function 見積_P番号を揃える(P番号) {
  var who = 画面_利用者_(); var props = PropertiesService.getScriptProperties();
  var n = Number(props.getProperty('見積_P番号') || 0); var h = Number(String(P番号 || '').replace(/^P/i, '')) || 0;
  if (h > n) { props.setProperty('見積_P番号', String(h)); n = h; }
  return { ok: true, user: who.email, 次: n + 1 };
}
function 見積_次の番号_(P番号, 種別) {
  var def = 段階[種別]; if (!def || !def.記号) throw new Error('Hub に置けるのは予算見積・見積だけです（受注は FileMaker）');
  var n = 0; 見積_全部_().forEach(function (x) { if (見積_P正規_(x['P番号']) === P番号 && String(x['種別']) === 種別) n++; });
  return P番号 + '-' + def.記号 + 桁揃え_(n + 1, 2);
}

/** 見積を起こす。fields（FileMaker の項目名）を写して P番号・種別・番号を付ける */
function 見積_起こす_(種別, fields, P番号, 元番号, who, 付帯) {
  if (!段階[種別] || !段階[種別].記号) throw new Error('Hub に起こせるのは予算見積・見積だけです（受注は FileMaker）');
  P番号 = 見積_P正規_(P番号); if (!P番号) throw new Error('P番号がありません');
  var j = {};
  Object.keys(fields || {}).forEach(function (k) { if (引き継がない.indexOf(k) >= 0 || 見積_固定.indexOf(k) >= 0) return; var v = fields[k]; if (v === null || v === undefined || v === '') return; j[k] = String(v); });
  j['作成者'] = who.email;
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    var no = 見積_次の番号_(P番号, 種別);
    var o = { '番号': no, 'P番号': P番号, '種別': 種別, '状態': '見積中', '起票日': 見積_今日_(), '修正日': 見積_今日_(), json: JSON.stringify(j), by: who.email, at: new Date().toISOString(),
              '受注伝票番号': '', '元': String(元番号 || ''), '問い合わせID': String((付帯 && 付帯.問い合わせID) || ''), '案件名': String((付帯 && 付帯.案件名) || '') };
    見積_書く_(o); log_(who, 'Hub見積', 'hub:' + no, { '起こした': 種別 + (元番号 ? '　元 ' + 元番号 : '') + '　' + P番号 }, {});
    return o;
  } finally { lock.releaseLock(); }
}
function 見積_初期値を分ける_(初期値) {
  var f = {}, 付帯 = { P番号: '', ヒント: '', 問い合わせID: '', 案件名: '' };
  Object.keys(初期値 || {}).forEach(function (k) {
    if (k === 'P番号') 付帯.P番号 = 初期値[k]; else if (k === 'P番号ヒント') 付帯.ヒント = 初期値[k];
    else if (k === '問い合わせID') 付帯.問い合わせID = 初期値[k]; else if (k === '案件名') 付帯.案件名 = 初期値[k]; else f[k] = 初期値[k];
  });
  return { fields: f, 付帯: 付帯 };
}

/** 画面_新規案件（予算見積・見積）: まっさらに起こす。P番号は 初期値.P番号 か新しい番号 */
function 見積_新規案件_(種別, 初期値) {
  var who = 画面_利用者_(); var d = 見積_初期値を分ける_(初期値);
  var P = 見積_P正規_(d.付帯.P番号) || 見積_次のP番号_(d.付帯.ヒント);
  return 見積_返す_(見積_起こす_(種別, d.fields, P, '', who, d.付帯), who);
}
/** 画面_新規段階: 案件ID が P番号なら Hub の続き（受注なら受注化）。FileMaker の案件ID でも予算見積・見積は Hub に起こす。返せなければ null（FileMaker の道へ） */
function 見積_新規段階_(案件ID, 種別, 初期値) {
  var who = 画面_利用者_(); var d = 見積_初期値を分ける_(初期値);
  if (HubP番号か_(案件ID)) {
    var last = 見積_P番号の一番新しい_(案件ID); if (!last) throw new Error(案件ID + ' の見積が保管庫にありません');
    if (種別 === '受注') return 見積_受注化(last['番号']);
    return 見積_返す_(見積_起こす_(種別, 見積_fields_(last), 案件ID, last['番号'], who, { 問い合わせID: last['問い合わせID'], 案件名: last['案件名'] }), who);
  }
  if (!段階[種別] || !段階[種別].記号) return null;   // FileMaker の案件から受注 → 今までどおり
  var base = 最新_(LAYOUTS.juchu, 案件ID); if (!base) throw new Error('案件 ' + 案件ID + ' が FileMaker に見つかりません');
  var f = base.fields; var 元 = String(f['伝票番号'] || f['見積番号'] || '');
  var P = 見積_P正規_(d.付帯.P番号) || 見積_次のP番号_(d.付帯.ヒント);
  var fields = {}; Object.keys(f).forEach(function (k) { fields[k] = f[k]; });
  if (String(f['案件区分'] || '受注') === '受注' && f['伝票番号']) { fields['前回伝票番号'] = String(f['伝票番号']); fields['前回起票日'] = String(f['起票日'] || ''); }
  return 見積_返す_(見積_起こす_(種別, fields, P, 元, who, d.付帯), who);
}
/** 画面_流用新規: 予算見積・見積は Hub に。元は Hub の見積でも FileMaker の伝票でもよい。返せなければ null */
function 見積_流用新規_(recordId, 種別, 同じ案件, 初期値) {
  var who = 画面_利用者_(); var d = 見積_初期値を分ける_(初期値);
  var hub = HubのrecordIdか_(recordId);
  if (種別 === '受注') return hub ? 見積_受注化(String(recordId).slice(4)) : null;
  if (!段階[種別] || !段階[種別].記号) return null;
  var src, 元, P = 見積_P正規_(d.付帯.P番号);
  if (hub) { var o = 見積_探す_(String(recordId).slice(4)); if (!o) throw new Error('元の見積が保管庫にありません'); src = 見積_fields_(o); 元 = o['番号']; if (同じ案件 === true || 同じ案件 === 'true' || 同じ案件 === 1) P = P || 見積_P正規_(o['P番号']); }
  else { var g = fmCall_('/layouts/' + encodeURIComponent(LAYOUTS.juchu) + '/records/' + recordId); if (g.code !== '0') throw new Error('元の伝票を読めません (' + g.code + ') ' + g.message); var dd = (g.response.data || [])[0]; if (!dd) throw new Error('元の伝票が見つかりません'); src = dd.fieldData || {}; 元 = String(src['伝票番号'] || src['見積番号'] || ''); }
  var fields = {}; Object.keys(src).forEach(function (k) { fields[k] = src[k]; });
  if (同じ案件 === true || 同じ案件 === 'true' || 同じ案件 === 1) { if (!hub && String(src['案件区分'] || '受注') === '受注') { fields['前回伝票番号'] = 元; fields['前回起票日'] = String(src['起票日'] || ''); } }
  else { delete fields['前回伝票番号']; delete fields['前回起票日']; }
  P = P || 見積_次のP番号_(d.付帯.ヒント);
  var r = 見積_返す_(見積_起こす_(種別, fields, P, 元, who, d.付帯), who); r.流用元 = 元; return r;
}
function 見積_消す_(recordId, modId) {
  var who = 画面_利用者_(); var o = 見積_探す_(String(recordId).slice(4)); if (!o) throw new Error('見積が保管庫にありません');
  if (modId && String(o.at) !== String(modId)) throw new Error('読み込んだあとに誰かが直しています。読み直してから消してください');
  if (o['受注伝票番号']) throw new Error('受注になった見積は消せません（' + o['受注伝票番号'] + '）');
  o['状態'] = '削除'; o['修正日'] = 見積_今日_(); o.by = who.email; o.at = new Date().toISOString(); 見積_書く_(o);
  log_(who, 'Hub見積', 'hub:' + o['番号'], { '削除': o['番号'] }, {});
  return { ok: true, user: who.email, 削除: o['番号'] };
}

// ------------------------------------------------------------ 受注化・状態・索引
/** 受注化: Hub の見積の内容で FileMaker に受注伝票を起こす（伝票番号は自動採番）。見積は「採用」として残す */
function 見積_受注化(番号) {
  var who = 画面_利用者_(); var o = 見積_探す_(番号); if (!o) throw new Error(番号 + ' が見積の保管庫にありません');
  if (o['受注伝票番号']) throw new Error(番号 + ' はもう受注になっています（' + o['受注伝票番号'] + '）');
  if (String(o['状態']) === '削除') throw new Error(番号 + ' は消した見積です');
  var f = 見積_fields_(o); var allow = {}; fieldInfo_(COPY_LAYOUT).writable.forEach(function (n) { allow[n] = true; });
  var init = {};
  Object.keys(f).forEach(function (k) { if (!allow[k] || 引き継がない.indexOf(k) >= 0 || 見積_固定.indexOf(k) >= 0) return; var v = f[k]; if (v === null || v === undefined || v === '') return; init[k] = String(v); });
  init['起票日'] = 日付_(new Date());
  var r = 画面_新規案件('受注', init);
  var 伝票 = String(r.案件ID || '');
  o['状態'] = '採用'; o['受注伝票番号'] = 伝票; o['修正日'] = 見積_今日_(); o.by = who.email; o.at = new Date().toISOString(); 見積_書く_(o);
  try { 手配_写す(o['番号'], 伝票); } catch (e) {}
  log_(who, 'Hub見積', 'hub:' + o['番号'], { '受注化': 伝票 }, {});
  r.見積番号 = o['番号']; r.P番号 = o['P番号']; r.受注化 = true;
  return r;
}
/** 状態: 見積中／提出済／失注／保留。失注だけ を返す（同じ P番号に受注・見積中が無ければ true → 案件フォルダに【失注】を付ける） */
function 見積_状態(番号, 状態) {
  var who = 画面_利用者_(); var o = 見積_探す_(番号); if (!o) throw new Error(番号 + ' が見積の保管庫にありません');
  if (['見積中', '提出済', '失注', '保留'].indexOf(String(状態)) < 0) throw new Error('知らない状態です: ' + 状態);
  if (o['受注伝票番号']) throw new Error('受注になった見積の状態は変えられません（' + o['受注伝票番号'] + '）');
  var 前 = { '状態': o['状態'] }; o['状態'] = 状態; o['修正日'] = 見積_今日_(); o.by = who.email; o.at = new Date().toISOString(); 見積_書く_(o);
  log_(who, 'Hub見積', 'hub:' + o['番号'], { '状態': 状態 }, 前);
  var P = 見積_P正規_(o['P番号']); var 生きている = false;
  見積_全部_().forEach(function (x) { if (見積_P正規_(x['P番号']) !== P || String(x['状態']) === '削除') return; if (x['受注伝票番号'] || ['失注'].indexOf(String(x['状態'])) < 0) 生きている = true; });
  return { ok: true, user: who.email, 番号: o['番号'], 状態: 状態, P番号: P, 失注だけ: !生きている, 案件名: o['案件名'] || '' };
}
/** Hub の見積の索引（写し_索引を配る と同じ列 ＋ 状態・受注伝票番号・P番号 …）。Hub 本体と見積入力の検索で使う */
function 見積_索引() {
  var who = 画面_利用者_();
  var 列 = ['recordId', '年', '伝票番号', '見積番号', '案件区分', '案件ID', '起票日', '納品日', '得意先コード', 'ユーザー名', '製品名', '品種', '合計数1', '売価金額', '合計金額', '納期', '単位', '売価単価', '修正日', '担当者コード', '前回伝票番号', 'ロット契約単位',
             '状態', '受注伝票番号', 'P番号', '問い合わせID', '案件名', 'by', 'at', '元'];
  var 行 = [];
  見積_全部_().forEach(function (o) {
    if (String(o['状態']) === '削除') return; var j = 見積_json_(o);
    行.push(['hub:' + o['番号'], 年_(o['起票日']), '', o['番号'], o['種別'], o['P番号'], o['起票日'], '', j['得意先コード'] || '', j['ユーザー名'] || '', j['製品名'] || '', j['品種'] || '', j['合計数1'] || '', j['売価金額'] || '', j['合計金額'] || '', j['納期'] || '', j['単位'] || '', j['売価単価'] || '', o['修正日'], j['担当者コード'] || '', j['前回伝票番号'] || '', j['ロット契約単位'] || '',
           o['状態'], o['受注伝票番号'], o['P番号'], o['問い合わせID'], o['案件名'], o.by, o.at, o['元']]);
  });
  var props = PropertiesService.getScriptProperties();
  return { ok: true, user: who.email, 列: 列, 行: 行, 件数: 行.length, 次P番号: Number(props.getProperty('見積_P番号') || 0) + 1, 作った: new Date().toISOString() };
}
