/**
 * YARUKOTO-1（本多さん 9/30）: 定期のやること・来たらやること・案件
 *
 *   ・毎年／2 年に一度の用事（入札参加資格の更新など）を忘れないように、期限が近づいたらメールで知らせ、済むまで一覧に残す
 *   ・定期の連絡（支援機関へのメールなど）は、宛先・件名・本文のひな形を持っておく。下書きを開くのは画面、送るのは人
 *   ・指名入札のように「来たらやる」ものは、誰が・どこに入って・何をするか をひな形にしておき、来たら 1 件の案件にする
 *   ・誰がいつ何をしたかは 履歴 に残す（画面からは消せない）
 *
 *   帳簿: 写しフォルダの「やること」（id / json / at / by / 消）。設定は id＝_設定 の行
 *   種類: 定期（周期で次回が入る）／ひな形（来たらやる。期限なし）／案件（1 回きり。ひな形から作る）
 *   見える＝'経営' のものは 本多・福永 だけに返す（読むのも書くのも）
 *   FileMaker にはさわらない。メールは会社 GAS（Hub 本体と同じ窓口）に頼んで出す。宛先は社内のドメインだけ
 */
var やること列 = ['id', 'json', 'at', 'by', '消'];
var やること_会社GAS = 'https://script.google.com/macros/s/AKfycbw9-8Nnq3jV9lCDUEf7JOvQM_yAy1ZYnOIab-TYP3TZ-BtH7RosxKSeXmr-FvkxMVhv/exec';
var やること_会社GASの鍵 = 'mitsumori-2024';
var やること_画面 = 'https://tokiwa1928.github.io/tokiwa-hub-app/tools/teiki.html';
var やること_種類 = ['定期', 'ひな形', '案件'];
var やること_単位 = ['年', '月', '週', '日'];

// ------------------------------------------------------------ 日付（日付だけを UTC のミリ秒にして数える。時差・夏時間に左右されない）
function やること_日_(s) { var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(s || '')); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN; }
function やること_文字_(ms) { var d = new Date(ms); return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2); }
function やること_今日_() { return Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd'); }
function やること_日付か_(s) { return !isNaN(やること_日_(s)) && やること_文字_(やること_日_(s)) === String(s); }
/** 日 に 数×単位 を足す。年・月は月末を越えない（1/31 の 1 か月後は 2/28） */
function やること_足す_(日, 数, 単位) {
  var ms = やること_日_(日); if (isNaN(ms)) return ''; 数 = Number(数) || 0;
  if (単位 === '日') return やること_文字_(ms + 数 * 864e5);
  if (単位 === '週') return やること_文字_(ms + 数 * 7 * 864e5);
  var d = new Date(ms), mm = d.getUTCMonth() + (単位 === '年' ? 数 * 12 : 数);
  var y2 = d.getUTCFullYear() + Math.floor(mm / 12), m2 = ((mm % 12) + 12) % 12, 末 = new Date(Date.UTC(y2, m2 + 1, 0)).getUTCDate();
  return やること_文字_(Date.UTC(y2, m2, Math.min(d.getUTCDate(), 末)));
}
/** 済んだあとの次回。数え方＝'済んだ日' なら済んだ日から、そうでなければ今の期限から数える。何回ぶんも過ぎていたら今日より先になるまで進める */
function やること_次回_(行, 済んだ日, 今日) {
  var 周 = 行.周期 || {}, 数 = Number(周.数) || 0; if (数 <= 0) return '';
  var 単位 = やること_単位.indexOf(周.単位) >= 0 ? 周.単位 : '年';
  var 元 = (行.数え方 === '済んだ日') ? (済んだ日 || 今日) : (行.期限 || 済んだ日 || 今日);
  var 次 = やること_足す_(元, 数, 単位), n = 0;
  while (次 && 次 <= 今日 && n++ < 400) 次 = やること_足す_(次, 数, 単位);
  return 次;
}
function やること_残り_(行, 今日) { var a = やること_日_(行.期限), b = やること_日_(今日); return (isNaN(a) || isNaN(b)) ? null : Math.round((a - b) / 864e5); }
/** 何日前から知らせるか。指定が無ければ 年単位（と半年以上）は 30 日前、それ以外は 7 日前 */
function やること_前_(行) { var n = Number(行.知らせ始め); if (n > 0) return n; var 周 = 行.周期 || {}; return (行.種類 === '定期' && (周.単位 === '年' || (周.単位 === '月' && Number(周.数) >= 6))) ? 30 : 7; }
function やること_生きている_(行) { return 行.種類 !== 'ひな形' && 行.状態 !== '済' && 行.状態 !== '止めた' && !!行.期限; }
function やること_範囲内_(行, 今日) { if (!やること_生きている_(行)) return false; var r = やること_残り_(行, 今日); return r !== null && r <= やること_前_(行); }
/** 今日メールで知らせるか: 範囲に入った日に 1 回 → そのあと週 1 回 → 期限の 3 日前からと過ぎたあとは毎日 */
function やること_知らせる日か_(行, 今日) {
  if (!やること_範囲内_(行, 今日)) return false;
  var 前回 = String(行.知らせた日 || ''); if (!前回) return true; if (前回 >= 今日) return false;
  if (やること_残り_(行, 今日) <= 3) return true;
  return (やること_日_(今日) - やること_日_(前回)) / 864e5 >= 7;
}

// ------------------------------------------------------------ 帳簿
function やること_表_() { return 写し_帳簿_('やること', やること列).getSheets()[0]; }
function やること_全部_() {
  var v = やること_表_().getDataRange().getValues(), out = [];
  for (var i = 1; i < v.length; i++) {
    if (v[i][4]) continue; var id = String(v[i][0] || ''); if (!id) continue;
    var o; try { o = JSON.parse(v[i][1] || '{}') || {}; } catch (e) { continue; }
    o.id = id; o._row = i + 1; o._at = (v[i][2] instanceof Date) ? v[i][2].toISOString() : String(v[i][2] || ''); o._by = String(v[i][3] || '');
    out.push(o);
  }
  return out;
}
function やること_置く_(行, who) {
  var o = {}; Object.keys(行).forEach(function (k) { if (k.charAt(0) !== '_' && k !== 'id') o[k] = 行[k]; });
  if (o.履歴 && o.履歴.length > 80) o.履歴 = o.履歴.slice(o.履歴.length - 80);   // 1 つのセルに入る量に収める（古いものから落とす）
  var js = JSON.stringify(o); if (js.length > 45000) throw new Error('内容が長すぎます（本文やメモを短くしてください）');
  var sh = やること_表_(), now = new Date().toISOString(), by = String((who && who.email) || '');
  if (行._row) sh.getRange(行._row, 2, 1, 4).setValues([[js, now, by, '']]); else sh.appendRow([行.id, js, now, by, '']);
}
function やること_鍵_(fn) { var lock = LockService.getScriptLock(); lock.waitLock(20000); try { return fn(); } finally { try { lock.releaseLock(); } catch (e) {} } }
function やること_管理者か_(who) { return マスタ管理者.indexOf(String((who && who.email) || '').toLowerCase()) >= 0; }
function やること_見えるか_(行, who) { return 行.見える !== '経営' || やること_管理者か_(who); }
function やること_外向き_(行) { var o = {}; Object.keys(行).forEach(function (k) { if (k !== '_row') o[k] = 行[k]; }); return o; }
function やること_探す_(all, id, who) {
  var 行 = null; all.forEach(function (x) { if (x.id === String(id || '') && x.id !== '_設定') 行 = x; });
  if (!行 || !やること_見えるか_(行, who)) throw new Error('見つかりません（消されたか、見られない項目です）');
  return 行;
}
function やること_履歴を足す_(行, who, 何, 追加) {
  var h = { at: new Date().toISOString(), by: String((who && who.email) || ''), 何: String(何 || '').slice(0, 300) };
  if (追加) Object.keys(追加).forEach(function (k) { if (追加[k] !== '' && 追加[k] != null) h[k] = 追加[k]; });
  行.履歴 = (行.履歴 || []).concat([h]);
}
function やること_社内の宛先か_(mail) {
  mail = String(mail || '').trim().toLowerCase(); if (!/^[^\s@,;<>]+@[^\s@,;<>]+\.[a-z]{2,}$/.test(mail)) return false;
  var doms = (PropertiesService.getScriptProperties().getProperty('ALLOWED_DOMAIN') || 'tokiwap-group.com,tokiwap.co.jp').split(',').map(function (d) { return d.trim().toLowerCase(); }).filter(function (d) { return d; });
  return doms.indexOf(mail.split('@')[1]) >= 0;
}
function やること_設定_(all) {
  var s = { 人: [], 知らせ先: '', 時刻: 8 };
  (all || やること_全部_()).forEach(function (x) { if (x.id === '_設定') { if (Array.isArray(x.人)) s.人 = x.人; s.知らせ先 = String(x.知らせ先 || ''); if (x.時刻 != null && x.時刻 !== '') s.時刻 = Number(x.時刻); s._row = x._row; } });
  return s;
}
function やること_知らせの状態_() { var on = false; try { ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'やること_毎朝') on = true; }); } catch (e) { return { 入っている: null }; } return { 入っている: on }; }

// ------------------------------------------------------------ 入口（コード.js の handle_ から。who はサインイン済みの人）
function やること_入口_(action, req, who) {
  switch (action) {
    case 'やること_一覧':         return やること_一覧_(who);
    case 'やること_書く':         return やること_書く_(who, req['行']);
    case 'やること_手順':         return やること_手順_(who, req.id, req.n, req['済']);
    case 'やること_記録':         return やること_記録_(who, req.id, req['何'], req['メモ']);
    case 'やること_済み':         return やること_済み_(who, req.id, req['内容']);
    case 'やること_案件にする':   return やること_案件にする_(who, req.id, req['内容']);
    case 'やること_消す':         return やること_消す_(who, req.id);
    case 'やること_設定_書く':    return やること_設定_書く_(who, req['設定']);
    case 'やること_知らせを入れる': return やること_知らせを入れる_(who, req['入れる']);
    case 'やること_今すぐ知らせる': return やること_今すぐ知らせる_(who);
  }
  throw new Error('知らない操作です: ' + action);
}

function やること_一覧_(who) {
  var all = やること_全部_(), 設定 = やること_設定_(all); delete 設定._row;
  var 行 = all.filter(function (x) { return x.id !== '_設定' && やること_見えるか_(x, who); }).map(やること_外向き_);
  return { ok: true, user: who.email, 管理者: やること_管理者か_(who), 今日: やること_今日_(), 行: 行, 設定: 設定, 知らせ: やること_知らせの状態_() };
}

/** 画面から来た 1 件を整える（知らない項目は捨てる。履歴・進み・知らせた日 は画面からは書けない） */
function やること_整える_(入) {
  入 = 入 || {}; var 文 = function (v, n) { return String(v == null ? '' : v).slice(0, n); };
  var o = { 種類: やること_種類.indexOf(入.種類) >= 0 ? 入.種類 : '定期', 分類: 文(入.分類, 40).trim(), 名前: 文(入.名前, 100).trim(), 相手: 文(入.相手, 100).trim(),
    期限: 文(入.期限, 10), 数え方: 入.数え方 === '済んだ日' ? '済んだ日' : '期限', 知らせ始め: Math.max(0, Math.min(365, Math.round(Number(入.知らせ始め) || 0))),
    担当: 文(入.担当, 40).trim(), 担当メール: 文(入.担当メール, 120).trim().toLowerCase(), 見える: 入.見える === '経営' ? '経営' : '全員', メモ: 文(入.メモ, 2000),
    状態: ['有効', '止めた', '進行中', '済'].indexOf(入.状態) >= 0 ? 入.状態 : '', 結果: 文(入.結果, 200), 元: 文(入.元, 40) };
  var 周 = 入.周期 || {}; o.周期 = { 数: Math.max(0, Math.min(120, Math.round(Number(周.数) || 0))), 単位: やること_単位.indexOf(周.単位) >= 0 ? 周.単位 : '年' };
  var ど = 入.どこ || {}; o.どこ = { 名前: 文(ど.名前, 80).trim(), url: 文(ど.url, 500).trim(), メモ: 文(ど.メモ, 500) };
  o.手順 = (Array.isArray(入.手順) ? 入.手順 : []).map(function (t) { return 文(t, 200).trim(); }).filter(function (t) { return t; }).slice(0, 20);
  var メ = 入.メール || {}; o.メール = { to: 文(メ.to, 300).trim(), cc: 文(メ.cc, 300).trim(), 件名: 文(メ.件名, 200), 本文: 文(メ.本文, 6000) };
  if (!o.名前) throw new Error('名前を入れてください');
  if (o.期限 && !やること_日付か_(o.期限)) throw new Error('期限の日付が読めません: ' + o.期限);
  if (o.どこ.url && !/^https?:\/\//i.test(o.どこ.url)) throw new Error('「どこに入るか」の URL は https:// から入れてください');
  if (o.担当メール && !やること_社内の宛先か_(o.担当メール)) throw new Error('知らせ先のメールは社内のアドレスにしてください: ' + o.担当メール);
  if (o.種類 === '定期') { if (!o.期限) throw new Error('定期のものは、次の期限を入れてください'); if (o.周期.数 <= 0) throw new Error('周期（何年・何か月ごと）を入れてください'); if (!o.状態 || o.状態 === '進行中' || o.状態 === '済') o.状態 = '有効'; }
  else if (o.種類 === 'ひな形') { o.期限 = ''; o.周期.数 = 0; if (o.状態 !== '止めた') o.状態 = '有効'; }
  else { o.周期.数 = 0; if (o.状態 !== '済') o.状態 = '進行中'; }
  return o;
}
function やること_書く_(who, 入) {
  return やること_鍵_(function () {
    var 新 = やること_整える_(入), all = やること_全部_(), id = String((入 && 入.id) || '').trim(), 旧 = id ? やること_探す_(all, id, who) : null;
    if (新.見える === '経営' && !やること_管理者か_(who)) throw new Error('「経営だけに見せる」にできるのは 本多さん・福永さん だけです');
    var 行;
    if (旧) {
      行 = 旧; var 変わった = [];
      if (String(旧.期限 || '') !== 新.期限) { 変わった.push('期限 ' + (旧.期限 || 'なし') + ' → ' + (新.期限 || 'なし')); 行.知らせた日 = ''; }
      if (String(旧.担当 || '') !== 新.担当) 変わった.push('担当 ' + (旧.担当 || 'なし') + ' → ' + (新.担当 || 'なし'));
      if (String(旧.状態 || '') !== 新.状態) 変わった.push('状態 ' + (旧.状態 || '') + ' → ' + 新.状態);
      if (JSON.stringify(旧.手順 || []) !== JSON.stringify(新.手順)) { 行.進み = {}; 変わった.push('手順を直した'); }   // 手順が変わったら、済みの印は付け直す
      Object.keys(新).forEach(function (k) { 行[k] = 新[k]; });
      やること_履歴を足す_(行, who, '直した' + (変わった.length ? '（' + 変わった.join('、') + '）' : ''));
    } else {
      行 = 新; 行.id = 'Y' + Date.now() + Math.floor(Math.random() * 1000); 行.進み = {}; 行.知らせた日 = ''; 行.作った日 = やること_今日_(); 行.履歴 = [];
      やること_履歴を足す_(行, who, '作った');
    }
    やること_置く_(行, who);
    return { ok: true, id: 行.id, 行: やること_外向き_(行) };
  });
}
/** 手順の 1 つに「済み」の印を付ける／外す。誰がいつ付けたかが残る */
function やること_手順_(who, id, n, 済) {
  return やること_鍵_(function () {
    var 行 = やること_探す_(やること_全部_(), id, who); n = Number(n);
    if (!(n >= 0 && n < (行.手順 || []).length)) throw new Error('その手順はありません（読み直してください）');
    行.進み = 行.進み || {};
    if (済) 行.進み[n] = { at: new Date().toISOString(), by: who.email || '' }; else delete 行.進み[n];
    やること_履歴を足す_(行, who, (済 ? '手順 ' + (n + 1) + ' を済ませた: ' : '手順 ' + (n + 1) + ' の印を外した: ') + 行.手順[n]);
    やること_置く_(行, who);
    return { ok: true, 行: やること_外向き_(行) };
  });
}
/** 履歴に 1 行足す（メールの下書きを開いた・電話した など） */
function やること_記録_(who, id, 何, メモ) {
  return やること_鍵_(function () {
    var 行 = やること_探す_(やること_全部_(), id, who); 何 = String(何 || '').trim(); if (!何) throw new Error('何をしたかを入れてください');
    やること_履歴を足す_(行, who, 何, { メモ: String(メモ || '').slice(0, 500) });
    やること_置く_(行, who);
    return { ok: true, 行: やること_外向き_(行) };
  });
}
/** 済んだ。定期は次回の期限が入り、手順の印と知らせの記録が消えて次の回になる。案件は「済」になって残る */
function やること_済み_(who, id, 内) {
  return やること_鍵_(function () {
    var 行 = やること_探す_(やること_全部_(), id, who); 内 = 内 || {}; var 今日 = やること_今日_();
    if (行.種類 === 'ひな形') throw new Error('ひな形は済みにできません（来たら「案件にする」を押してください）');
    var 済んだ日 = やること_日付か_(内.済んだ日) ? 内.済んだ日 : 今日, メモ = String(内.メモ || '').slice(0, 500);
    if (行.種類 === '定期') {
      var 次 = 内.次回 ? String(内.次回) : やること_次回_(行, 済んだ日, 今日);
      if (!やること_日付か_(次)) throw new Error('次回の日付が読めません: ' + 次);
      if (次 <= 済んだ日) throw new Error('次回は、済んだ日より後の日にしてください');
      やること_履歴を足す_(行, who, '済んだ', { 期限: 行.期限, 済んだ日: 済んだ日, 次回: 次, メモ: メモ });
      行.前回 = 済んだ日; 行.期限 = 次; 行.進み = {}; 行.知らせた日 = ''; 行.状態 = '有効';
    } else {
      if (行.状態 === '済') throw new Error('もう済みになっています');
      行.状態 = '済'; 行.済んだ日 = 済んだ日; 行.結果 = String(内.結果 || '').slice(0, 200);
      やること_履歴を足す_(行, who, '済んだ', { 期限: 行.期限, 済んだ日: 済んだ日, 結果: 行.結果, メモ: メモ });
    }
    やること_置く_(行, who);
    return { ok: true, 行: やること_外向き_(行) };
  });
}
/** ひな形（来たらやる）から 1 件の案件を作る。誰が・どこに入って・何をするか はひな形から写す */
function やること_案件にする_(who, id, 内) {
  return やること_鍵_(function () {
    var all = やること_全部_(), 元 = やること_探す_(all, id, who); 内 = 内 || {};
    if (元.種類 !== 'ひな形') throw new Error('案件にできるのは「来たらやる（ひな形）」だけです');
    var 名前 = String(内.名前 || '').trim().slice(0, 100); if (!名前) throw new Error('件名を入れてください');
    var 期限 = String(内.期限 || ''); if (!やること_日付か_(期限)) throw new Error('期限（入札の締切など）を入れてください');
    var 行 = { id: 'Y' + Date.now() + Math.floor(Math.random() * 1000), 種類: '案件', 分類: 元.分類 || '', 名前: 名前, 相手: 元.相手 || '', 期限: 期限, 周期: { 数: 0, 単位: '年' }, 数え方: '期限',
      知らせ始め: Number(内.知らせ始め) > 0 ? Math.min(365, Math.round(Number(内.知らせ始め))) : (Number(元.知らせ始め) || 0),
      担当: String(内.担当 || 元.担当 || '').slice(0, 40), 担当メール: String(内.担当メール || 元.担当メール || '').toLowerCase().slice(0, 120), 見える: 元.見える === '経営' ? '経営' : '全員',
      どこ: 元.どこ || {}, 手順: (元.手順 || []).slice(), メール: 元.メール || {}, メモ: String(内.メモ || '').slice(0, 2000), 状態: '進行中', 結果: '', 元: 元.id, 進み: {}, 知らせた日: '', 作った日: やること_今日_(), 履歴: [] };
    if (行.担当メール && !やること_社内の宛先か_(行.担当メール)) throw new Error('知らせ先のメールは社内のアドレスにしてください: ' + 行.担当メール);
    やること_履歴を足す_(行, who, '案件にした（ひな形: ' + (元.名前 || '') + '）');
    やること_置く_(行, who);
    やること_履歴を足す_(元, who, '案件にした: ' + 名前 + '（期限 ' + 期限 + '）'); やること_置く_(元, who);
    return { ok: true, id: 行.id, 行: やること_外向き_(行) };
  });
}
function やること_消す_(who, id) {
  return やること_鍵_(function () {
    var 行 = やること_探す_(やること_全部_(), id, who);
    やること_表_().getRange(行._row, 3, 1, 3).setValues([[new Date().toISOString(), who.email || '', 1]]);   // 行は残し、消 の印だけ付ける
    return { ok: true, id: 行.id };
  });
}
function やること_設定_書く_(who, 入) {
  if (!やること_管理者か_(who)) throw new Error('設定を変えられるのは 本多さん・福永さん だけです');
  return やること_鍵_(function () {
    入 = 入 || {}; var 今 = やること_設定_();
    var 人 = (Array.isArray(入.人) ? 入.人 : []).map(function (p) { return { 名前: String((p && p.名前) || '').trim().slice(0, 40), メール: String((p && p.メール) || '').trim().toLowerCase().slice(0, 120) }; }).filter(function (p) { return p.名前; }).slice(0, 60);
    人.forEach(function (p) { if (p.メール && !やること_社内の宛先か_(p.メール)) throw new Error('メールは社内のアドレスにしてください: ' + p.名前 + ' ' + p.メール); });
    var 先 = String(入.知らせ先 || '').trim().toLowerCase(); if (先 && !やること_社内の宛先か_(先)) throw new Error('知らせ先は社内のアドレスにしてください: ' + 先);
    var 時 = Math.round(Number(入.時刻)); if (!(時 >= 0 && 時 <= 23)) 時 = 8;
    var 変わる = 時 !== 今.時刻;
    やること_置く_({ id: '_設定', _row: 今._row, 人: 人, 知らせ先: 先, 時刻: 時 }, who);
    if (変わる && やること_知らせの状態_().入っている) { トリガーを外す_('やること_毎朝'); ScriptApp.newTrigger('やること_毎朝').timeBased().atHour(時).everyDays(1).create(); }   // 入っていれば時刻を付け替える
    return { ok: true, 設定: { 人: 人, 知らせ先: 先, 時刻: 時 } };
  });
}
function やること_知らせを入れる_(who, 入れる) {
  if (!やること_管理者か_(who)) throw new Error('毎朝の知らせを入れたり外したりできるのは 本多さん・福永さん だけです');
  トリガーを外す_('やること_毎朝');
  if (入れる) ScriptApp.newTrigger('やること_毎朝').timeBased().atHour(やること_設定_().時刻).everyDays(1).create();
  return { ok: true, 知らせ: やること_知らせの状態_() };
}

// ------------------------------------------------------------ メール（毎朝）
/** 知らせる先: 担当のメール → 担当の名前から引いたメール → 既定の知らせ先 → 本多さん。経営だけのものは、担当が決まっていなければ既定の知らせ先には回さず本多さんへ */
function やること_宛先_(行, 設定) { var m = String(行.担当メール || '').toLowerCase(); if (!m && 行.担当) (設定.人 || []).forEach(function (p) { if (p.名前 === 行.担当 && p.メール) m = p.メール; }); if (m) return m; return (行.見える === '経営') ? マスタ管理者[0] : (設定.知らせ先 || マスタ管理者[0]); }
function やること_メール文_(名前, list, 今日) {
  var 行文 = function (x) {
    var r = やること_残り_(x, 今日), いつ = r < 0 ? (-r) + ' 日過ぎています' : r === 0 ? '今日まで' : 'あと ' + r + ' 日';
    var t = '・' + (x.名前 || '') + (x.相手 ? '（' + x.相手 + '）' : '') + '\n　期限 ' + x.期限 + '（' + いつ + '）' + (x.担当 ? '　担当: ' + x.担当 : '');
    var 残 = (x.手順 || []).filter(function (s, i) { return !(x.進み && x.進み[i]); });
    if (x.どこ && (x.どこ.名前 || x.どこ.url)) t += '\n　どこで: ' + [x.どこ.名前, x.どこ.url].filter(function (v) { return v; }).join(' ');
    if (残.length) t += '\n　残りの手順: ' + 残.join(' → ');
    return t + '\n　開く: ' + やること_画面 + '#' + x.id;
  };
  var 過 = list.filter(function (x) { return やること_残り_(x, 今日) < 0; }), 近 = list.filter(function (x) { return やること_残り_(x, 今日) >= 0; });
  var 件名 = '【Hub やること】期限が近いものが ' + list.length + ' 件あります' + (過.length ? '（うち ' + 過.length + ' 件は期限を過ぎています）' : '');
  var 本文 = (名前 ? 名前 + ' さん\n\n' : '') + '期限が近い「やること」です。済んだら Hub で「済んだ」を押してください（押すまで一覧に残り、このメールも続きます）。\n'
    + (過.length ? '\n■ 期限を過ぎています\n' + 過.map(行文).join('\n') + '\n' : '') + (近.length ? '\n■ もうすぐ\n' + 近.map(行文).join('\n') + '\n' : '')
    + '\n一覧を開く: ' + やること_画面 + '\n\n※ このメールは Hub が自動で送っています（返信は届きません）。';
  return { 件名: 件名, 本文: 本文 };
}
/** 会社 GAS に頼んでメールを出す（中継にはメールを出す権限を持たせていない）。宛先は社内のドメインだけ */
function やること_メール_(to, 件名, 本文) {
  if (!やること_社内の宛先か_(to)) throw new Error('社内のアドレスではないので送りません: ' + to);
  var res = UrlFetchApp.fetch(やること_会社GAS, { method: 'post', contentType: 'text/plain;charset=utf-8', muteHttpExceptions: true,
    payload: JSON.stringify({ action: 'forwardInquiryToEmail', apiKey: やること_会社GASの鍵, replyTo: to, subject: 件名, body: 本文, by: 'やること' }) });
  var r = null; try { r = JSON.parse(res.getContentText()); } catch (e) {}
  if (!r || !r.success) throw new Error('メールを出せませんでした: ' + ((r && r.error) || ('HTTP ' + res.getResponseCode())));
  return true;
}
/** 毎朝のトリガー。今日知らせる項目がある人にだけ、その人の「範囲内の全部」を 1 通にまとめて出す */
function やること_毎朝() { return やること_知らせる_(null); }
function やること_知らせる_(試しの宛先) {
  var 今日 = やること_今日_(), all = やること_全部_(), 設定 = やること_設定_(all), 組 = {};
  all.forEach(function (x) { if (x.id === '_設定' || !やること_範囲内_(x, 今日)) return; var to = 試しの宛先 || やること_宛先_(x, 設定); (組[to] = 組[to] || []).push(x); });
  var 出した = [], 失敗 = [];
  Object.keys(組).forEach(function (to) {
    var list = 組[to].sort(function (a, b) { return String(a.期限) < String(b.期限) ? -1 : 1; });
    if (!試しの宛先 && !list.some(function (x) { return やること_知らせる日か_(x, 今日); })) return;
    var 名前 = ''; (設定.人 || []).forEach(function (p) { if (p.メール === to) 名前 = p.名前; });
    try {
      var m = やること_メール文_(名前, list, 今日); やること_メール_(to, (試しの宛先 ? '（試し）' : '') + m.件名, m.本文); 出した.push({ 宛先: to, 件数: list.length });
      if (!試しの宛先) やること_鍵_(function () { var 今 = やること_全部_(); list.forEach(function (x) { 今.forEach(function (y) { if (y.id === x.id) { y.知らせた日 = 今日; やること_置く_(y, { email: y._by || 'hub' }); } }); }); });
    } catch (e) { 失敗.push({ 宛先: to, 理由: String(e.message || e) }); }
  });
  try { Logger.log('やること: 出した ' + JSON.stringify(出した) + ' 失敗 ' + JSON.stringify(失敗)); } catch (e) {}
  return { ok: true, 今日: 今日, 出した: 出した, 失敗: 失敗 };
}
/** 試しに、いま範囲内のもの全部を自分あてに 1 通（知らせた日は変えない） */
function やること_今すぐ知らせる_(who) {
  if (!やること_管理者か_(who)) throw new Error('試しの送信は 本多さん・福永さん だけです');
  return やること_知らせる_(String(who.email || '').toLowerCase());
}
