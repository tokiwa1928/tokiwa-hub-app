/**
 * 案件の記録・保管の窓口（KIROKU-1 / STORE-1 ── 本多さん 11/5「この業界で一番大事なのは情報管理」）
 *
 *   ① 案件の記録: 電話・口頭・FAX・メール・来社などで受けた指示を、日付と伝達方法つきで案件（伝票番号・案件ID）に残す。
 *      「大事（翌年も出す）」に印を付けたものは、リピートや同じ案件の次の伝票を開いたときに一緒に出る。
 *   ② 保管の窓口: 案件のファイル（記録の添付・原稿・FAX など）を置く場所は、ここ 1 か所だけを通す。
 *      今は Google ドライブ（保管庫 › 仕様書 › 伝票番号）。スクリプトプロパティに Box の鍵を入れると Box に切り替わる。
 *        STORAGE            'box' にすると Box を使う（無ければ drive）
 *        BOX_CLIENT_ID      Box の「Client Credentials Grant」アプリのクライアント ID
 *        BOX_CLIENT_SECRET  同じくクライアントシークレット
 *        BOX_ENTERPRISE_ID  Box の Enterprise ID（管理コンソール › アカウント情報）
 *        BOX_ROOT_FOLDER_ID 案件フォルダを作る親フォルダの ID（URL の /folder/ の後ろ）
 */

var 記録列 = ['id', '伝票番号', '案件ID', '日付', '方法', '相手', '受けた人', '内容', '大事', '添付', '作成者', '作成日時', '消'];
var 記録の方法 = ['電話', '口頭', '来社', '訪問', 'FAX', 'メール', 'LINE WORKS', '郵送', '校正の戻り', 'その他'];
function 記録_帳簿_() { return 写し_帳簿_('案件の記録', 記録列).getSheets()[0]; }
function 記録_行を物に_(v) {
  var o = {}; 記録列.forEach(function (c, i) { var x = v[i]; o[c] = (x instanceof Date) ? Utilities.formatDate(x, 'Asia/Tokyo', c === '日付' ? 'yyyy-MM-dd' : "yyyy-MM-dd'T'HH:mm:ss") : (x == null ? '' : x); });
  try { o.添付 = o.添付 ? JSON.parse(o.添付) : []; } catch (e) { o.添付 = []; }
  o.大事 = o.大事 === true || o.大事 === 'TRUE' || o.大事 === '1' || o.大事 === 1; return o;
}
/** 記録を読む。番号たち（伝票番号・見積番号）と案件ID たちのどれかに当たるものを、日付の新しい順に */
function 記録_一覧(番号たち, 案件IDたち) {
  var who = 画面_利用者_(); var sh = 記録_帳簿_(); var last = sh.getLastRow(); if (last < 2) return { ok: true, user: who.email, 行: [], 方法: 記録の方法 };
  var nos = {}, ids = {}; (番号たち || []).forEach(function (x) { x = String(x || '').trim(); if (x) nos[x] = 1; }); (案件IDたち || []).forEach(function (x) { x = String(x || '').trim(); if (x) ids[x] = 1; });
  var v = sh.getRange(2, 1, last - 1, 記録列.length).getValues(), out = [];
  v.forEach(function (r) { if (r[12]) return; if (nos[String(r[1])] || (r[2] && ids[String(r[2])])) out.push(記録_行を物に_(r)); });
  out.sort(function (a, b) { return a.日付 !== b.日付 ? (a.日付 < b.日付 ? 1 : -1) : (a.作成日時 < b.作成日時 ? 1 : -1); });
  return { ok: true, user: who.email, 行: out, 方法: 記録の方法 };
}
/** 記録を書く（id があれば上書き）。添付は [{name,url,id}] */
function 記録_書く(行) {
  var who = 画面_利用者_(); 行 = 行 || {}; if (!String(行.伝票番号 || 行.案件ID || '').trim()) throw new Error('伝票番号か案件ID が要ります');
  if (!String(行.内容 || '').trim() && !(行.添付 || []).length) throw new Error('内容が空です');
  var sh = 記録_帳簿_(); var id = String(行.id || '').trim() || ('K' + Date.now() + Math.floor(Math.random() * 1000));
  var row = [id, String(行.伝票番号 || ''), String(行.案件ID || ''), String(行.日付 || Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd')), String(行.方法 || 'その他'),
    String(行.相手 || ''), String(行.受けた人 || who.email.split('@')[0]), String(行.内容 || ''), 行.大事 ? true : false, JSON.stringify(行.添付 || []), who.email, new Date(), ''];
  var last = sh.getLastRow(), at = 0;
  if (行.id && last > 1) { var ids = sh.getRange(2, 1, last - 1, 1).getValues(); for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === id) { at = i + 2; break; } }
  if (at) { var 元 = sh.getRange(at, 1, 1, 記録列.length).getValues()[0]; row[10] = 元[10] || row[10]; row[11] = 元[11] || row[11]; sh.getRange(at, 1, 1, 記録列.length).setValues([row]); }
  else sh.appendRow(row);
  return { ok: true, user: who.email, 行: 記録_行を物に_(row) };
}
function 記録_消す(id) {
  var who = 画面_利用者_(); var sh = 記録_帳簿_(); var last = sh.getLastRow(); if (last < 2) return { ok: true };
  var ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) { sh.getRange(i + 2, 13).setValue('消 ' + who.email + ' ' + new Date().toISOString()); return { ok: true, user: who.email }; }
  return { ok: true, user: who.email, 無かった: true };
}

// ---------------------------------------------------------------- 保管の窓口（Drive ⇔ Box）
function 保管_先_() { return String(PropertiesService.getScriptProperties().getProperty('STORAGE') || 'drive').toLowerCase(); }
/** 案件のファイルを置く。区分（記録・原稿・FAX など）はファイル名の頭に付ける */
function 保管_置く(番号, 名, mime, base64, 区分) {
  var who = 画面_利用者_(); if (!番号 || !base64) throw new Error('番号とファイルが要ります');
  var nm = (区分 ? '[' + 区分 + '] ' : '') + String(名 || 'file');
  if (保管_先_() === 'box') { var r = Box_置く_(String(番号), nm, mime, base64); r.ok = true; r.user = who.email; r.保管先 = 'Box'; return r; }
  var d = 仕様書_置く(番号, nm, mime, base64); d.保管先 = 'Google ドライブ'; return d;
}
function 保管_一覧(番号) {
  var who = 画面_利用者_(); if (!番号) return { ok: true, user: who.email, files: [] };
  if (保管_先_() === 'box') { var r = Box_一覧_(String(番号)); r.ok = true; r.user = who.email; r.保管先 = 'Box'; return r; }
  var d = 仕様書_一覧(番号); d.保管先 = 'Google ドライブ'; return d;
}
function 保管_状態() {
  var who = 画面_利用者_(); var p = PropertiesService.getScriptProperties();
  var box = { 鍵: !!(p.getProperty('BOX_CLIENT_ID') && p.getProperty('BOX_CLIENT_SECRET') && p.getProperty('BOX_ENTERPRISE_ID')), 親フォルダ: p.getProperty('BOX_ROOT_FOLDER_ID') || '' };
  var 試し = ''; if (box.鍵) { try { Box_トークン_(); 試し = 'つながりました'; } catch (e) { 試し = String(e.message || e); } }
  return { ok: true, user: who.email, 保管先: 保管_先_() === 'box' ? 'Box' : 'Google ドライブ', box: box, 試し: 試し };
}

// ---------------------------------------------------------------- Box（Client Credentials Grant）
function Box_トークン_() {
  var c = CacheService.getScriptCache(), hit = c.get('box_token'); if (hit) return hit;
  var p = PropertiesService.getScriptProperties();
  var res = UrlFetchApp.fetch('https://api.box.com/oauth2/token', { method: 'post', muteHttpExceptions: true, payload: {
    grant_type: 'client_credentials', client_id: p.getProperty('BOX_CLIENT_ID'), client_secret: p.getProperty('BOX_CLIENT_SECRET'),
    box_subject_type: 'enterprise', box_subject_id: p.getProperty('BOX_ENTERPRISE_ID') } });
  if (res.getResponseCode() !== 200) throw new Error('Box に入れません (' + res.getResponseCode() + ') ' + res.getContentText().slice(0, 200));
  var j = JSON.parse(res.getContentText()); c.put('box_token', j.access_token, Math.max(60, (j.expires_in || 3600) - 300)); return j.access_token;
}
function Box_呼ぶ_(method, path, body) {
  var res = UrlFetchApp.fetch('https://api.box.com/2.0' + path, { method: method, muteHttpExceptions: true, contentType: 'application/json', headers: { Authorization: 'Bearer ' + Box_トークン_() }, payload: body ? JSON.stringify(body) : undefined });
  var code = res.getResponseCode(), t = res.getContentText(); var j = {}; try { j = JSON.parse(t || '{}'); } catch (e) {}
  return { code: code, j: j, t: t };
}
/** 親の下に名前のフォルダ（無ければ作る）。同名があれば 409 の中の id を使う */
function Box_フォルダ_(親, 名) {
  var r = Box_呼ぶ_('post', '/folders', { name: 名, parent: { id: String(親) } });
  if (r.code === 201) return r.j.id;
  if (r.code === 409 && r.j.context_info && r.j.context_info.conflicts && r.j.context_info.conflicts[0]) return r.j.context_info.conflicts[0].id;
  throw new Error('Box のフォルダを作れません (' + r.code + ') ' + r.t.slice(0, 200));
}
function Box_案件フォルダ_(番号) {
  var p = PropertiesService.getScriptProperties(); var root = p.getProperty('BOX_ROOT_FOLDER_ID'); if (!root) throw new Error('BOX_ROOT_FOLDER_ID が未設定です');
  var c = CacheService.getScriptCache(), key = 'boxf_' + 番号, hit = c.get(key); if (hit) return hit;
  var nm = String(番号).replace(/[\\\/:*?"<>|]/g, '_'); var id = Box_フォルダ_(root, nm); c.put(key, id, 21600); return id;
}
function Box_置く_(番号, 名, mime, base64) {
  var fid = Box_案件フォルダ_(番号); var bytes = Utilities.base64Decode(base64); if (bytes.length > 50 * 1024 * 1024) throw new Error('50MB を超えています');
  var nm = String(名).replace(/[\\\/:*?"<>|]/g, '_');
  var boundary = '----tokiwa' + Date.now(); var attrs = JSON.stringify({ name: nm, parent: { id: String(fid) } });
  var head = Utilities.newBlob('--' + boundary + '\r\nContent-Disposition: form-data; name="attributes"\r\n\r\n' + attrs + '\r\n--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="' + nm + '"\r\nContent-Type: ' + (mime || 'application/octet-stream') + '\r\n\r\n').getBytes();
  var tail = Utilities.newBlob('\r\n--' + boundary + '--\r\n').getBytes();
  var res = UrlFetchApp.fetch('https://upload.box.com/api/2.0/files/content', { method: 'post', muteHttpExceptions: true, contentType: 'multipart/form-data; boundary=' + boundary, headers: { Authorization: 'Bearer ' + Box_トークン_() }, payload: head.concat(bytes).concat(tail) });
  var code = res.getResponseCode(); var j = {}; try { j = JSON.parse(res.getContentText()); } catch (e) {}
  if (code === 409) { nm = nm.replace(/(\.[^.]+)?$/, ' (' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'HHmmss') + ')$1'); return Box_置く_(番号, nm, mime, base64); }
  if (code !== 201) throw new Error('Box に置けません (' + code + ') ' + res.getContentText().slice(0, 200));
  var e = (j.entries || [])[0] || {};
  return { file: { id: e.id, name: e.name, url: 'https://app.box.com/file/' + e.id, size: e.size, at: new Date().toISOString() }, folderUrl: 'https://app.box.com/folder/' + fid };
}
function Box_一覧_(番号) {
  var fid = Box_案件フォルダ_(番号); var r = Box_呼ぶ_('get', '/folders/' + fid + '/items?fields=id,name,size,modified_at,type&limit=100');
  if (r.code !== 200) throw new Error('Box を読めません (' + r.code + ')');
  var out = (r.j.entries || []).filter(function (x) { return x.type === 'file'; }).map(function (x) { return { id: x.id, name: x.name, url: 'https://app.box.com/file/' + x.id, size: x.size, at: x.modified_at }; });
  out.sort(function (a, b) { return a.at < b.at ? 1 : -1; });
  return { files: out, folderUrl: 'https://app.box.com/folder/' + fid };
}
