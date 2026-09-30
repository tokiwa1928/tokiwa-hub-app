/**
 * MENZUKE-1（本多さん 9/30）: 面付ツール（折丁面付台）を関連会社へ公開する。
 *
 *   ・ログイン … Google アカウント（登録したメールアドレス）か、ログインID＋パスワード
 *   ・会社ごとの公開設定 … 使える／全体のパターンを見る／自社のパターンを登録できる
 *   ・パターン … 各社で登録したものは各社だけ、全体に登録したものは全社に見える。
 *                中身が同じ面付は保存のときに知らせる（同じものが乱立しないように）
 *   ・設定を変えられるのは トキワ印刷の本多・福永 だけ（Google アカウントで確かめる）
 *
 * FileMaker には一切さわらない。入口（doPost）で 面付_ で始まる操作だけここへ来る。
 * 社内ドメインの確認（authorize_）は通らないので、ここで自分で確かめる。
 */
var 面付会社 = [['TK', 'トキワ印刷株式会社'], ['MU', '村山印刷有限会社'], ['TS', '株式会社津島プリント社'], ['KT', '有限会社北上プリント'],
               ['AS', '有限会社アート・エス'], ['NK', '中尾印刷株式会社'], ['YM', 'ヤマウチ印刷株式会社'], ['SN', '株式会社ソネ商事']];
var 面付管理者 = ['honda@tokiwap.co.jp', 'fukunaga@tokiwap.co.jp'];
var 面付列 = {
  利用者: ['id', 'ログイン', '名前', '会社', '停止', '要変更', 'by', 'at', '消'],
  会社設定: ['会社', '使える', '全体を見る', '登録できる', 'by', 'at'],
  パターン: ['id', '範囲', '名前', 'json', '指紋', 'by', '会社', 'at', '消'],
  券: ['券の指紋', '利用者id', '期限', 'at']
};
var 面付_券の日数 = 30, 面付_回数 = 500;

function 面付_表_(名) { return 写し_帳簿_('面付_' + 名, 面付列[名]).getSheets()[0]; }
function 面付_行_(名) {   // 1 行＝1 件のオブジェクト（_row つき）。消したものは除く
  var v = 面付_表_(名).getDataRange().getValues(), 列 = 面付列[名], out = [];
  for (var i = 1; i < v.length; i++) { var o = { _row: i + 1 }; for (var j = 0; j < 列.length; j++) { var x = v[i][j]; o[列[j]] = (x instanceof Date) ? x.toISOString() : (x === null || x === undefined ? '' : x); } if (列.indexOf('消') >= 0 && o['消']) continue; if (!String(o[列[0]] || '')) continue; out.push(o); }
  return out;
}
function 面付_書く_(名, o) {   // _row があればその行を、無ければ足す
  var 列 = 面付列[名], sh = 面付_表_(名); var row = 列.map(function (c) { var x = o[c]; return (x === null || x === undefined) ? '' : x; });
  if (o._row) sh.getRange(o._row, 1, 1, 列.length).setValues([row]); else sh.appendRow(row);
}
function 面付_会社名_(c) { for (var i = 0; i < 面付会社.length; i++) if (面付会社[i][0] === c) return 面付会社[i][1]; return ''; }
function 面付_はい_(x) { return x === true || /^(1|true|TRUE|はい|○)$/.test(String(x)); }
function 面付_今_() { return new Date().toISOString(); }
function 面付_id_(頭) { return 頭 + Date.now().toString(36) + Math.floor(Math.random() * 46656).toString(36); }

// ---------------------------------------------------------------- 合言葉
function 面付_十六_(bytes) { var s = ''; for (var i = 0; i < bytes.length; i++) { var b = bytes[i]; if (b < 0) b += 256; s += (b < 16 ? '0' : '') + b.toString(16); } return s; }
function 面付_指紋_(文) { return 'h' + 面付_十六_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(文), Utilities.Charset.UTF_8)); }
function 面付_ハッシュ_(pw, salt) {
  var b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + pw, Utilities.Charset.UTF_8);
  var s = Utilities.newBlob(String(salt)).getBytes();
  for (var i = 0; i < 面付_回数; i++) b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, b.concat(s));
  return 面付_十六_(b);
}
function 面付_PWを入れる_(id, pw) { var salt = Utilities.getUuid().replace(/-/g, ''); PropertiesService.getScriptProperties().setProperty('MZPW_' + id, salt + ':' + 面付_ハッシュ_(pw, salt)); }
function 面付_PWが合う_(id, pw) {
  var v = PropertiesService.getScriptProperties().getProperty('MZPW_' + id); if (!v) return false; var p = String(v).split(':'); if (p.length !== 2) return false;
  var h = 面付_ハッシュ_(pw, p[0]); if (h.length !== p[1].length) return false; var d = 0; for (var i = 0; i < h.length; i++) d |= (h.charCodeAt(i) ^ p[1].charCodeAt(i)); return d === 0;
}
function 面付_PWがある_(id) { return !!PropertiesService.getScriptProperties().getProperty('MZPW_' + id); }
function 面付_PWの決まり_(pw) { pw = String(pw || ''); if (pw.length < 8) throw new Error('パスワードは 8 文字以上にしてください'); if (pw.length > 100) throw new Error('パスワードが長すぎます'); if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) throw new Error('パスワードには英字と数字の両方を入れてください'); return pw; }
function 面付_仮PW_() { var 字 = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'; var u = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''); var s = ''; for (var i = 0; i < 10; i++) s += 字.charAt(parseInt(u.substr(i * 3, 3), 16) % 字.length); return s + String(parseInt(u.substr(40, 2), 16) % 10); }

// ------------------------------------------------------------------ 券
function 面付_券を出す_(利用者id) {
  var 券 = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''); var 期限 = new Date(Date.now() + 面付_券の日数 * 86400000).toISOString();
  面付_古い券を消す_(); 面付_表_('券').appendRow([面付_指紋_(券), 利用者id, 期限, 面付_今_()]);
  return { 券: 券, 期限: 期限 };
}
function 面付_古い券を消す_(利用者id) {   // 期限切れと、指定した人の券を消す
  var sh = 面付_表_('券'), v = sh.getDataRange().getValues(), now = Date.now();
  for (var i = v.length - 1; i >= 1; i--) { var t = new Date(v[i][2]).getTime(); if (!t || t < now || (利用者id && String(v[i][1]) === String(利用者id))) sh.deleteRow(i + 1); }
}
function 面付_券の持ち主_(券) {
  券 = String(券 || ''); if (券.length < 32) return ''; var h = 面付_指紋_(券), v = 面付_表_('券').getDataRange().getValues(), now = Date.now();
  for (var i = 1; i < v.length; i++) if (String(v[i][0]) === h && new Date(v[i][2]).getTime() > now) return String(v[i][1]);
  return '';
}

// ------------------------------------------------------------- 誰なのか
function 面付_Googleの人_(idToken) {   // authorize_ と同じ確かめ方。ただしドメインではなく、登録してあるかで決める
  var res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('Google のログインを確認できませんでした。もう一度ログインしてください');
  var info = JSON.parse(res.getContentText()); var email = String(info.email || '').toLowerCase();
  if (info.email_verified !== true && info.email_verified !== 'true') throw new Error('メールアドレスが確認されていません');
  var web = PropertiesService.getScriptProperties().getProperty('WEB_CLIENT_ID');
  if (web && String(info.aud || '') !== web) throw new Error('この画面あてのログインではありません');
  if (!email) throw new Error('メールアドレスが分かりません');
  return { email: email, name: String(info.name || '') };
}
function 面付_人にする_(u, 管理者) { return { id: String(u.id || ''), ログイン: String(u['ログイン'] || ''), 名前: String(u['名前'] || ''), 会社: String(u['会社'] || ''), 会社名: 面付_会社名_(String(u['会社'] || '')), 管理者: !!管理者, 要変更: 面付_はい_(u['要変更']) }; }
function 面付_メールの人_(g) {
  var email = g.email, us = 面付_行_('利用者'); var 管 = 面付管理者.indexOf(email) >= 0;
  var hit = us.filter(function (u) { return String(u['ログイン']).toLowerCase() === email; })[0];
  if (管) return 面付_人にする_({ id: hit ? hit.id : 'admin:' + email, ログイン: email, 名前: (hit && hit['名前']) || g.name || email, 会社: 'TK' }, true);
  if (!hit) { var dom = email.slice(email.lastIndexOf('@')); var rule = us.filter(function (u) { return String(u['ログイン']).toLowerCase() === dom; })[0]; if (rule && !面付_はい_(rule['停止'])) return 面付_人にする_({ id: 'dom:' + email, ログイン: email, 名前: g.name || email, 会社: rule['会社'] }, false); }
  if (!hit) throw new Error('このメールアドレス（' + email + '）は登録されていません。トキワ印刷の本多・福永に登録を頼んでください');
  if (面付_はい_(hit['停止'])) throw new Error('この利用者は止められています。トキワ印刷の本多・福永に確認してください');
  var p = 面付_人にする_(hit, false); p.要変更 = false; return p;
}
function 面付_誰_(req) {
  if (req['券']) { var id = 面付_券の持ち主_(req['券']); if (!id) throw new Error('ログインの期限が切れました。もう一度ログインしてください');
    var u = 面付_行_('利用者').filter(function (x) { return String(x.id) === id; })[0]; if (!u || 面付_はい_(u['停止'])) throw new Error('この利用者は使えなくなっています。もう一度ログインしてください');
    var p = 面付_人にする_(u, false); p.券で = true; return p; }
  if (req.idToken) { var q = 面付_メールの人_(面付_Googleの人_(req.idToken)); q.Googleで = true; return q; }
  throw new Error('ログインしてください');
}
function 面付_管理者だけ_(who) { if (!who.管理者 || !who.Googleで) throw new Error('設定は トキワ印刷の本多・福永 だけです（Google アカウントでログインしてください）'); }

// ------------------------------------------------------------ 会社の設定
function 面付_会社の設定_(会社) {
  var r = 面付_行_('会社設定').filter(function (x) { return String(x['会社']) === 会社; })[0];
  if (!r) return { 会社: 会社, 会社名: 面付_会社名_(会社), 使える: 会社 === 'TK', 全体を見る: true, 登録できる: true, 既定: true };
  return { 会社: 会社, 会社名: 面付_会社名_(会社), 使える: 面付_はい_(r['使える']), 全体を見る: 面付_はい_(r['全体を見る']), 登録できる: 面付_はい_(r['登録できる']), _row: r._row };
}
function 面付_使えるか_(who) {
  if (!面付_会社名_(who.会社)) throw new Error('所属の会社が決まっていません。トキワ印刷の本多・福永に確認してください');
  var s = 面付_会社の設定_(who.会社); if (who.管理者) { s.使える = true; s.全体を見る = true; s.登録できる = true; }
  if (!s.使える) throw new Error(s.会社名 + ' にはまだ公開されていません。トキワ印刷の本多・福永に確認してください');
  return s;
}

// ---------------------------------------------------------------- パターン
function 面付_範囲名_(範囲) { return 範囲 === '全体' ? '全体' : (面付_会社名_(範囲) || 範囲); }
function 面付_パターンを返す_(p) { var v = {}; try { v = JSON.parse(p.json || '{}') || {}; } catch (e) {} return { id: String(p.id), 範囲: String(p['範囲']), 範囲名: 面付_範囲名_(String(p['範囲'])), 名前: String(p['名前']), v: v, 指紋: String(p['指紋'] || ''), by: String(p.by || ''), at: String(p.at || '') }; }
function 面付_見えるパターン_(who, 設定) {
  return 面付_行_('パターン').filter(function (p) { return (String(p['範囲']) === '全体' && 設定.全体を見る) || String(p['範囲']) === who.会社; })
    .sort(function (a, b) { var x = (a['範囲'] === '全体' ? 0 : 1) - (b['範囲'] === '全体' ? 0 : 1); return x || String(a['名前']).localeCompare(String(b['名前'])); });
}
function 面付_パターン保存_(who, 設定, req) {
  var 名前 = String(req['名前'] || '').trim(); if (!名前) throw new Error('パターンの名前を入れてください'); if (名前.length > 80) throw new Error('名前が長すぎます（80 文字まで）');
  var v = req.v; if (!v || typeof v !== 'object') throw new Error('面付の設定がありません'); var js = JSON.stringify(v); if (js.length > 20000) throw new Error('設定が大きすぎます');
  var 範囲 = req['範囲'] === '全体' ? '全体' : who.会社;
  if (範囲 === '全体' && !who.管理者) throw new Error('全体への登録は トキワ印刷の本多・福永 だけです。自社に登録してから、全体に上げるよう頼んでください');
  if (範囲 !== '全体' && !設定.登録できる) throw new Error(設定.会社名 + ' はパターンを登録できない設定です');
  var 指紋 = 面付_指紋_(String(req['指紋'] || '').slice(0, 4000) || js);   // 画面が作った「中身だけ」の文字列（名前・ジョブ名を除く）から
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var all = 面付_行_('パターン'); var 同名 = all.filter(function (p) { return String(p['範囲']) === 範囲 && String(p['名前']) === 名前; })[0];
    if (同名 && !req['上書き']) return { ok: false, 同名: true, 名前: 名前, 範囲名: 面付_範囲名_(範囲) };
    var 重複 = all.filter(function (p) { if (同名 && p.id === 同名.id) return false; if (String(p['指紋']) !== 指紋) return false; return String(p['範囲']) === 範囲 || (String(p['範囲']) === '全体' && 設定.全体を見る); });
    if (重複.length && !req['強行']) return { ok: false, 重複: 重複.map(function (p) { return { id: String(p.id), 名前: String(p['名前']), 範囲: String(p['範囲']), 範囲名: 面付_範囲名_(String(p['範囲'])) }; }) };
    var o = 同名 || { id: 面付_id_('P') }; o['範囲'] = 範囲; o['名前'] = 名前; o.json = js; o['指紋'] = 指紋; o.by = who.ログイン; o['会社'] = who.会社; o.at = 面付_今_(); o['消'] = '';
    面付_書く_('パターン', o); try { log_({ email: who.ログイン }, '面付パターン', o.id, { 範囲: 範囲, 名前: 名前, 上書き: !!同名 }, {}); } catch (e) {}
    return { ok: true, id: o.id, 上書き: !!同名, 範囲: 範囲, 範囲名: 面付_範囲名_(範囲) };
  } finally { lock.releaseLock(); }
}
function 面付_パターン削除_(who, 設定, id) {
  var p = 面付_行_('パターン').filter(function (x) { return String(x.id) === String(id); })[0]; if (!p) return { ok: true, 無い: true };
  if (String(p['範囲']) === '全体') { if (!who.管理者) throw new Error('全体のパターンを消せるのは トキワ印刷の本多・福永 だけです'); }
  else if (!who.管理者) { if (String(p['範囲']) !== who.会社) throw new Error('ほかの会社のパターンは消せません'); if (!設定.登録できる) throw new Error(設定.会社名 + ' はパターンを変えられない設定です'); }
  p['消'] = '消 ' + who.ログイン + ' ' + 面付_今_(); 面付_書く_('パターン', p); try { log_({ email: who.ログイン }, '面付パターン', p.id, { 消: p['名前'] }, {}); } catch (e) {}
  return { ok: true };
}

// ------------------------------------------------------------------ 入る
function 面付_入った返事_(who, 券) {
  var 設定 = 面付_使えるか_(who);
  var r = { ok: true, 利用者: { ログイン: who.ログイン, 名前: who.名前, 会社: who.会社, 会社名: who.会社名, 管理者: !!who.管理者, 要変更: !!who.要変更, Google: !!who.Googleで },
    設定: { 使える: 設定.使える, 全体を見る: 設定.全体を見る, 登録できる: 設定.登録できる }, パターン: 面付_見えるパターン_(who, 設定).map(面付_パターンを返す_) };
  if (券) { r.券 = 券.券; r.期限 = 券.期限; }
  return r;
}
function 面付_パスワードで入る_(req) {
  var login = String(req['ログイン'] || '').trim().toLowerCase(), pw = String(req['パスワード'] || ''); if (!login || !pw) throw new Error('ログインID とパスワードを入れてください');
  var cache = CacheService.getScriptCache(), key = 'mzf_' + 面付_指紋_(login).slice(0, 24); var n = Number(cache.get(key) || 0);
  if (n >= 5) throw new Error('何度も間違えたので、15 分ほど待ってからやり直してください');
  var u = 面付_行_('利用者').filter(function (x) { return String(x['ログイン']).toLowerCase() === login && login.charAt(0) !== '@'; })[0];
  if (!u || !面付_PWが合う_(u.id, pw)) { cache.put(key, String(n + 1), 900); throw new Error('ログインID かパスワードが違います'); }
  if (面付_はい_(u['停止'])) throw new Error('この利用者は止められています。トキワ印刷の本多・福永に確認してください');
  cache.remove(key); var who = 面付_人にする_(u, false); 面付_使えるか_(who);
  return 面付_入った返事_(who, 面付_券を出す_(u.id));
}
function 面付_パスワード変更_(who, req) {
  if (!who.券で) throw new Error('Google アカウントでログインしているときは、パスワードは要りません');
  if (!面付_PWが合う_(who.id, String(req['今の'] || ''))) throw new Error('今のパスワードが違います');
  var pw = 面付_PWの決まり_(req['新しい']); if (pw === String(req['今の'] || '')) throw new Error('今と違うパスワードにしてください');
  面付_PWを入れる_(who.id, pw); var u = 面付_行_('利用者').filter(function (x) { return String(x.id) === who.id; })[0]; if (u) { u['要変更'] = ''; u.at = 面付_今_(); 面付_書く_('利用者', u); }
  面付_古い券を消す_(who.id); var 券 = 面付_券を出す_(who.id); return { ok: true, 券: 券.券, 期限: 券.期限 };
}

// ---------------------------------------------------------------- 設定（本多・福永）
function 面付_設定_読む_() {
  var us = 面付_行_('利用者'), ps = 面付_行_('パターン'); var 同じ = {}; ps.forEach(function (p) { var k = String(p['指紋'] || ''); if (k) 同じ[k] = (同じ[k] || 0) + 1; });
  return { ok: true,
    会社: 面付会社.map(function (c) { var s = 面付_会社の設定_(c[0]); return { 会社: c[0], 会社名: c[1], 使える: s.使える, 全体を見る: s.全体を見る, 登録できる: s.登録できる, 利用者数: us.filter(function (u) { return String(u['会社']) === c[0]; }).length, パターン数: ps.filter(function (p) { return String(p['範囲']) === c[0]; }).length }; }),
    利用者: us.map(function (u) { return { id: String(u.id), ログイン: String(u['ログイン']), 名前: String(u['名前']), 会社: String(u['会社']), 会社名: 面付_会社名_(String(u['会社'])), 停止: 面付_はい_(u['停止']), 要変更: 面付_はい_(u['要変更']), パスワード: 面付_PWがある_(String(u.id)), at: String(u.at || '') }; }),
    パターン: ps.map(function (p) { var o = 面付_パターンを返す_(p); o.同じ = 同じ[o.指紋] || 1; delete o.v; return o; }),
    管理者: 面付管理者, 全体の数: ps.filter(function (p) { return String(p['範囲']) === '全体'; }).length };
}
function 面付_設定_会社_(who, req) {
  var c = String(req['会社'] || ''); if (!面付_会社名_(c)) throw new Error('知らない会社です: ' + c);
  var s = 面付_会社の設定_(c); var o = { 会社: c, 使える: req['使える'] ? 1 : '', 全体を見る: req['全体を見る'] ? 1 : '', 登録できる: req['登録できる'] ? 1 : '', by: who.ログイン, at: 面付_今_(), _row: s._row };
  面付_書く_('会社設定', o); try { log_({ email: who.ログイン }, '面付会社設定', c, { 使える: !!req['使える'], 全体を見る: !!req['全体を見る'], 登録できる: !!req['登録できる'] }, {}); } catch (e) {}
  return { ok: true };
}
function 面付_設定_利用者_(who, req) {
  var login = String(req['ログイン'] || '').trim().toLowerCase(), 名前 = String(req['名前'] || '').trim(), 会社 = String(req['会社'] || '');
  if (!login) throw new Error('ログインID（メールアドレス）を入れてください'); if (login.length > 120 || /\s/.test(login)) throw new Error('ログインID に空白は使えません'); if (!面付_会社名_(会社)) throw new Error('会社を選んでください');
  var us = 面付_行_('利用者'); var u = req.id ? us.filter(function (x) { return String(x.id) === String(req.id); })[0] : null; if (req.id && !u) throw new Error('その利用者が見つかりません');
  if (us.some(function (x) { return String(x['ログイン']).toLowerCase() === login && (!u || x.id !== u.id); })) throw new Error('同じログインID が既にあります: ' + login);
  if (!u) u = { id: 面付_id_('U'), 要変更: '' };
  u['ログイン'] = login; u['名前'] = 名前; u['会社'] = 会社; u['停止'] = req['停止'] ? 1 : ''; u.by = who.ログイン; u.at = 面付_今_(); u['消'] = '';
  面付_書く_('利用者', u); if (req['停止']) 面付_古い券を消す_(u.id);
  try { log_({ email: who.ログイン }, '面付利用者', u.id, { ログイン: login, 会社: 会社, 停止: !!req['停止'] }, {}); } catch (e) {}
  return { ok: true, id: u.id };
}
function 面付_設定_利用者削除_(who, id) {
  var u = 面付_行_('利用者').filter(function (x) { return String(x.id) === String(id); })[0]; if (!u) return { ok: true, 無い: true };
  u['消'] = '消 ' + who.ログイン + ' ' + 面付_今_(); 面付_書く_('利用者', u); 面付_古い券を消す_(u.id); try { PropertiesService.getScriptProperties().deleteProperty('MZPW_' + u.id); } catch (e) {}
  try { log_({ email: who.ログイン }, '面付利用者', u.id, { 消: u['ログイン'] }, {}); } catch (e) {}
  return { ok: true };
}
function 面付_設定_仮パスワード_(who, id) {   // 仮のパスワードを出す（この返事の 1 回だけ見える）。本人が最初のログインで決め直す
  var u = 面付_行_('利用者').filter(function (x) { return String(x.id) === String(id); })[0]; if (!u) throw new Error('その利用者が見つかりません');
  if (String(u['ログイン']).charAt(0) === '@') throw new Error('ドメインの決まり（@…）にはパスワードを出せません。Google アカウントでログインします');
  var pw = 面付_仮PW_(); 面付_PWを入れる_(u.id, pw); u['要変更'] = 1; u.at = 面付_今_(); 面付_書く_('利用者', u); 面付_古い券を消す_(u.id);
  try { log_({ email: who.ログイン }, '面付利用者', u.id, { 仮パスワード: '出した' }, {}); } catch (e) {}
  return { ok: true, ログイン: String(u['ログイン']), 仮パスワード: pw };
}
function 面付_設定_パターン_(who, req) {   // 全体に上げる・会社へ戻す・名前を変える・消す
  var all = 面付_行_('パターン'); var p = all.filter(function (x) { return String(x.id) === String(req.id); })[0]; if (!p) throw new Error('そのパターンが見つかりません');
  if (req['消']) { p['消'] = '消 ' + who.ログイン + ' ' + 面付_今_(); 面付_書く_('パターン', p); return { ok: true }; }
  var 範囲 = req['範囲'] ? String(req['範囲']) : String(p['範囲']); if (範囲 !== '全体' && !面付_会社名_(範囲)) throw new Error('知らない範囲です: ' + 範囲);
  var 名前 = req['名前'] ? String(req['名前']).trim().slice(0, 80) : String(p['名前']);
  if (all.some(function (x) { return x.id !== p.id && String(x['範囲']) === 範囲 && String(x['名前']) === 名前; })) throw new Error('「' + 面付_範囲名_(範囲) + '」に同じ名前のパターンが既にあります: ' + 名前);
  var 前 = { 範囲: p['範囲'], 名前: p['名前'] }; p['範囲'] = 範囲; p['名前'] = 名前; p.at = 面付_今_(); 面付_書く_('パターン', p);
  try { log_({ email: who.ログイン }, '面付パターン', p.id, { 範囲: 範囲, 名前: 名前 }, 前); } catch (e) {}
  return { ok: true };
}

// ------------------------------------------------------------------ 入口
function 面付_入口_(req) {
  var act = String(req.action || '');
  if (act === '面付_入る' && req['ログイン']) return 面付_パスワードで入る_(req);
  var who = 面付_誰_(req);
  if (act === '面付_入る') return 面付_入った返事_(who, null);
  if (act === '面付_出る') { if (who.券で) { var h = 面付_指紋_(String(req['券'])), sh = 面付_表_('券'), v = sh.getDataRange().getValues(); for (var i = v.length - 1; i >= 1; i--) if (String(v[i][0]) === h) sh.deleteRow(i + 1); } return { ok: true }; }
  if (/^面付_設定_/.test(act)) {
    面付_管理者だけ_(who);
    switch (act) {
      case '面付_設定_読む':         return 面付_設定_読む_();
      case '面付_設定_会社':         return 面付_設定_会社_(who, req);
      case '面付_設定_利用者':       return 面付_設定_利用者_(who, req);
      case '面付_設定_利用者削除':   return 面付_設定_利用者削除_(who, req.id);
      case '面付_設定_仮パスワード': return 面付_設定_仮パスワード_(who, req.id);
      case '面付_設定_パターン':     return 面付_設定_パターン_(who, req);
    }
    throw new Error('知らない操作です: ' + act);
  }
  var 設定 = 面付_使えるか_(who);
  switch (act) {
    case '面付_パスワード変更': return 面付_パスワード変更_(who, req);
    case '面付_パターン一覧':   return { ok: true, パターン: 面付_見えるパターン_(who, 設定).map(面付_パターンを返す_) };
    case '面付_パターン保存':   return 面付_パターン保存_(who, 設定, req);
    case '面付_パターン削除':   return 面付_パターン削除_(who, 設定, req.id);
  }
  throw new Error('知らない操作です: ' + act);
}
