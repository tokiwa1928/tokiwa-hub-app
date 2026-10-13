/**
 * 名刺中継（Tokiwa Hub ⇔ 旗艦PC の Illustrator）
 *
 *   Hub（ブラウザ・どのPC/スマホでも）
 *     → この中継（GAS・Google サインインで社内の人か確かめる）
 *     → 共有ドライブ「トキワ印刷株式会社/50_メディア/DTP自動化/名刺」
 *     → 旗艦PC の Google ドライブ（W:）に同期 → ウォッチャーが run/*.jsx を Illustrator で実行
 *     → できた .ai・校正PDF・結果が同じフォルダに戻る → この中継が画面に返す
 *
 * スクリプトプロパティ
 *   ROOT_FOLDER_ID   受け渡しフォルダ「名刺」のフォルダID（無ければ自動で探して入れる）
 *   ALLOWED_DOMAIN   許すドメイン（カンマ区切り・既定 tokiwap-group.com,tokiwap.co.jp）
 *   WEB_CLIENT_ID    Hub の OAuth クライアントID（無ければ下の既定値＝FileMaker中継と同じもの）
 *   ENGINE_PATH      旗艦PC上のエンジン（既定 C:/Users/honda/Downloads/MEISHI/engine/meishi_engine.jsx）
 */

var ENGINE_DEFAULT = 'C:/Users/honda/Downloads/MEISHI/engine/meishi_engine.jsx';
// Hub の OAuth クライアントID（FileMaker中継と同じ・秘密ではない）
var WEB_CLIENT_DEFAULT = '301364298857-pmt4p3fq440fh6hct3m8avcnlf11jos7.apps.googleusercontent.com';

// ------------------------------------------------------------------ 入口
function doPost(e) {
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var who = authorize_(req);
    return json_({ ok: true, user: who.email, data: handle_(req.action, req, who) });
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}
function doGet() { return json_({ ok: true, note: '名刺中継です。Hub の「名刺 差し替え作成」から使います。' }); }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function handle_(action, req, who) {
  switch (action) {
    case 'init':       return init_();
    case 'submit':     return submit_(req.job || {}, who);
    case 'result':     return result_(String(req.id || ''));
    case 'saveRecord': return saveRecord_(String(req.tpl || ''), req.person || {}, who);
    case 'status':     return { alive: alive_() };
  }
  throw new Error('知らない操作です: ' + action);
}

// ------------------------------------------------------------------ サインイン確認（FileMaker中継と同じ）
function authorize_(req) {
  var props = PropertiesService.getScriptProperties();
  var domains = (props.getProperty('ALLOWED_DOMAIN') || 'tokiwap-group.com,tokiwap.co.jp')
    .split(',').map(function (d) { return d.trim().toLowerCase(); }).filter(String);
  if (!req.idToken) throw new Error('サインインが必要です');
  var res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(req.idToken), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('サインインを確認できませんでした');
  var info = JSON.parse(res.getContentText());
  var email = String(info.email || '').toLowerCase();
  if (info.email_verified !== true && info.email_verified !== 'true') throw new Error('メールアドレスが確認されていません');
  var web = props.getProperty('WEB_CLIENT_ID') || WEB_CLIENT_DEFAULT;
  if (web && String(info.aud || '') !== web) throw new Error('この画面あてのサインインではありません');
  var at = email.lastIndexOf('@');
  if (at < 0 || domains.indexOf(email.slice(at + 1)) < 0) throw new Error('社内のアカウントでサインインしてください');
  return { email: email };
}

// ------------------------------------------------------------------ フォルダ
var ROOT_PATH = ['トキワ印刷株式会社', '50_メディア', 'DTP自動化', '名刺'];   // 共有ドライブ内の受け渡しフォルダ
var _root = null;
function root_() {
  if (_root) return _root;
  var props = PropertiesService.getScriptProperties(), id = props.getProperty('ROOT_FOLDER_ID');
  if (!id) {   // 未設定なら「DTP自動化/名刺」を探して覚える
    var it = DriveApp.searchFolders("title = 'DTP自動化'");
    while (it.hasNext() && !id) {
      var d = it.next(), p = d.getParents(), ok = p.hasNext() && p.next().getName() === ROOT_PATH[1];
      var c = d.getFoldersByName(ROOT_PATH[3]);
      if (ok && c.hasNext()) id = c.next().getId();
    }
    if (!id) throw new Error('受け渡しフォルダ（' + ROOT_PATH.join('/') + '）が見つかりません。ROOT_FOLDER_ID を設定してください');
    props.setProperty('ROOT_FOLDER_ID', id);
  }
  return (_root = DriveApp.getFolderById(id));
}
function sub_(name) {
  var r = root_(), it = r.getFoldersByName(name);
  return it.hasNext() ? it.next() : r.createFolder(name);
}
function fileIn_(folder, name) { var it = folder.getFilesByName(name); return it.hasNext() ? it.next() : null; }
function readJson_(folder, name) {
  var f = fileIn_(folder, name); if (!f) return null;
  return JSON.parse(f.getBlob().getDataAsString('UTF-8').replace(/^\uFEFF/, ''));
}
function writeText_(folder, name, text) {
  var f = fileIn_(folder, name);
  if (f) f.setContent(text); else folder.createFile(name, text, MimeType.PLAIN_TEXT);
}
function alive_() {
  var f = fileIn_(sub_('run'), 'alive.txt');
  return f ? f.getLastUpdated().toISOString() : null;
}

// ------------------------------------------------------------------ 一覧
function templates_() {
  var out = [], it = sub_('templates').getFiles();
  while (it.hasNext()) {
    var f = it.next(); if (!/_tpl\.json$/.test(f.getName())) continue;
    try { var t = JSON.parse(f.getBlob().getDataAsString('UTF-8').replace(/^\uFEFF/, '')); t._file = f.getName(); out.push(t); } catch (e) {}
  }
  out.sort(function (a, b) { return String(a.client).localeCompare(String(b.client), 'ja'); });
  return out;
}
function init_() {
  var tpls = templates_(), recs = {}, rf = sub_('records');
  tpls.forEach(function (t) { recs[t.id] = readJson_(rf, t.id + '.json') || { tpl: t.id, persons: [] }; });
  return { templates: tpls, records: recs, alive: alive_() };
}

// ------------------------------------------------------------------ 依頼
function clean_(s, max) { s = String(s == null ? '' : s); if (s.length > max) throw new Error('長すぎる値があります'); return s; }
function submit_(job, who) {
  var tpl = templates_().filter(function (t) { return t.id === job.tpl; })[0];
  if (!tpl) throw new Error('テンプレートが見つかりません: ' + job.tpl);
  var mode = job.mode === 'extract' ? 'extract' : 'fill';
  var id = 'm' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd_HHmmss') + '_' + Utilities.getUuid().slice(0, 4);
  var j = { id: id, mode: mode, by: who.email, at: new Date().toISOString(),
            tpl_config: 'templates/' + tpl._file, result_path: 'jobs/' + id + '_result.json' };
  if (job.source) {
    var src = clean_(job.source, 400).replace(/\\/g, '/');
    // 読ませてよいのは NAS・受け渡しフォルダの out・W: の .ai だけ
    if (!/\.ai$/i.test(src) || !(/^\/\/192\.168\.0\.245\//.test(src) || /^out\//.test(src) || /^W:\//i.test(src)) || /\.\.\//.test(src))
      throw new Error('読み込める .ai の場所ではありません');
    j.source = src;
  }
  if (mode === 'fill') {
    var f = {}, keys = tpl.fields.map(function (x) { return x.key; });
    keys.forEach(function (k) { if (job.fields && job.fields[k] != null) f[k] = clean_(job.fields[k], 300); });
    if (!f.name) throw new Error('氏名が空です');
    j.fields = f;
    j.out_dir = 'out/' + tpl.id;
    j.out_name = clean_(job.out_name, 160).replace(/[\\\/:*?"<>|]/g, '_');
    if (!j.out_name) throw new Error('ファイル名が空です');
  }
  writeText_(sub_('jobs'), id + '.json', JSON.stringify(j, null, 1));
  var engine = PropertiesService.getScriptProperties().getProperty('ENGINE_PATH') || ENGINE_DEFAULT;
  var jsx = '// 名刺中継が作った実行ファイル（' + id + '）\n'
    + 'var JOB_ROOT = new File($.fileName).parent.parent.fsName.replace(/\\\\/g, "/");\n'
    + 'var JOB_PATH = JOB_ROOT + "/jobs/' + id + '.json";\n'
    + 'var src = new File(' + JSON.stringify(engine) + '); src.encoding = "UTF-8"; src.open("r"); var code = src.read(); src.close(); eval(code); "ok";\n';
  sub_('run').createFile(id + '.jsx', jsx, MimeType.PLAIN_TEXT);
  return { id: id, alive: alive_() };
}

// ------------------------------------------------------------------ 結果
function result_(id) {
  if (!/^m\d{8}_\d{6}_[0-9a-f]{4}$/.test(id)) throw new Error('番号が違います');
  var r = readJson_(sub_('jobs'), id + '_result.json');
  if (!r) {
    var run = sub_('run');
    var err = fileIn_(run, id + '.jsx.error.txt');
    if (err) return { state: 'error', error: err.getBlob().getDataAsString().replace(/^\uFEFF/, '') };
    var state = fileIn_(run, id + '.jsx') ? 'queued' : (fileIn_(run, id + '.jsx.running') ? 'running' : 'wait-sync');
    return { state: state, alive: alive_() };
  }
  r.state = 'done';
  // 校正PDF を添えて返す（out/<tpl>/ の中から名前で探す）
  var pdf = (r.files || []).filter(function (p) { return /_校正\.pdf$/.test(p); })[0];
  if (pdf) {
    var nm = String(pdf).split(/[\\\/]/).pop(), dirs = String(pdf).replace(/\\/g, '/').split('/'), tplDir = dirs[dirs.length - 2];
    var it = sub_('out').getFoldersByName(tplDir), f = it.hasNext() ? fileIn_(it.next(), nm) : null;
    if (f) { r.pdf_name = nm; r.pdf_b64 = Utilities.base64Encode(f.getBlob().getBytes()); r.pdf_url = f.getUrl(); }
    else r.pdf_pending = true;   // 旗艦PCからまだ上がってきていない
  }
  return r;
}

// ------------------------------------------------------------------ 名刺マスタ
function saveRecord_(tplId, person, who) {
  if (!/^[a-z0-9_]+$/.test(tplId)) throw new Error('テンプレートIDが違います');
  if (!person || !person.id || !person.fields) throw new Error('保存する内容がありません');
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var rf = sub_('records'), rec = readJson_(rf, tplId + '.json') || { tpl: tplId, persons: [] };
    person._updatedBy = who.email; person._updatedAt = new Date().toISOString();
    var i = rec.persons.map(function (p) { return p.id; }).indexOf(person.id);
    if (i >= 0) rec.persons[i] = person; else rec.persons.push(person);
    writeText_(rf, tplId + '.json', JSON.stringify(rec, null, 1));
    return rec;
  } finally { lock.releaseLock(); }
}

// ------------------------------------------------------------------ 設置の確認（編集画面から実行）
function セットアップ確認() {
  var p = PropertiesService.getScriptProperties(), log = [];
  try { var r = root_(); log.push('○ 受け渡しフォルダ: ' + r.getName() + '（ID ' + r.getId() + '）'); }
  catch (e) { log.push('× ROOT_FOLDER_ID: ' + e.message); Logger.log(log.join('\n')); return; }
  ['run', 'jobs', 'out', 'records', 'templates'].forEach(function (n) { log.push('○ ' + n + ' フォルダ'); sub_(n); });
  var t = templates_(); log.push((t.length ? '○ ' : '△ ') + 'テンプレート ' + t.length + '件: ' + t.map(function (x) { return x.client; }).join(', '));
  var a = alive_(); log.push((a ? '○ ' : '△ ') + '旗艦PCの最終確認: ' + (a || 'まだ届いていません'));
  log.push('○ WEB_CLIENT_ID: ' + (p.getProperty('WEB_CLIENT_ID') || WEB_CLIENT_DEFAULT));
  Logger.log(log.join('\n'));
}
