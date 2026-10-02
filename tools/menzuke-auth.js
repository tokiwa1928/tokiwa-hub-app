/**
 * MENZUKE-1: 面付ツールのログイン（関連会社へ公開するため）
 *
 *   <script src="fm-bridge.js"></script>      Google のログインはこの窓口のものを使う
 *   <script src="menzuke-auth.js"></script>
 *   MZ.始める({ 管理者だけ: false, 入った: function (状態) { … } })
 *
 *   ・Google アカウント（登録したメールアドレス）か、ログインID＋パスワードで入る
 *   ・誰が・どの会社で・何ができるかは中継（Apps Script）が決める。この画面は結果を出すだけ
 *   ・通信できないときだけ、7 日以内にこのブラウザで入った人は続けて使える（パターンは前回のもの）
 */
(function (global) {
  'use strict';
  var 中継 = 'https://script.google.com/macros/s/' + 'AKfycby3DCpR4kCCQMBZ0a8sdsBArM1z_J3JJKcIMYNOHLlhzB1LNrYPqw_NM-dxo_JirSyK4g/exec';
  var 券の置き場 = 'mz_ken', 前回の置き場 = 'mz_last', 猶予 = 7 * 86400000;
  var 状態 = null, 設定 = {}, 幕 = null;
  // LOGIN-LATER（本多さん 9/30）: 正式運用までは、ログイン画面を出さずにそのまま使える（内蔵パターンだけ・登録は不可）。
  //   正式運用にするときは true にする（開いたときにログイン画面が出るようになる）。公開設定の画面はいつでもログイン必須
  var 正式運用 = false;
  function ログインなしの状態() { return { ゲスト: true, 利用者: { 会社: '', 会社名: '', 名前: '', 管理者: false, ゲスト: true }, 設定: { 全体を見る: true, 登録できる: false }, パターン: [] }; }
  function 読む(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function 置く(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) {} }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function 通信の失敗か(e) { return /Failed to fetch|NetworkError|Load failed|中継の返事を読めません/.test(String(e && e.message)); }

  function 送る(body) {
    var 残り = 3;
    function 試す() {
      return fetch(中継, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), redirect: 'follow' })
        .then(function (res) { return res.text().then(function (t) { var r; try { r = JSON.parse(t); } catch (e) { throw new Error('中継の返事を読めませんでした（' + res.status + '）'); } if (!r.ok) throw new Error(r.error || '不明なエラー'); return r.data; }); })
        .catch(function (e) { if (--残り > 0 && 通信の失敗か(e)) return new Promise(function (r) { setTimeout(r, 1200); }).then(試す); throw e; });
    }
    return 試す();
  }
  // いまのログイン（券か Google のトークン）を添えて呼ぶ
  function 呼ぶ(action, body) {
    var b = { action: action }; Object.keys(body || {}).forEach(function (k) { b[k] = body[k]; });
    var 券 = 読む(券の置き場);
    if (状態 && 状態.ゲスト) return Promise.reject(new Error('ログインしてください（右上の「ログイン」）'));   // ログインなしのときは、勝手に Google の窓を出さない
    if (券 && !(状態 && 状態.利用者 && 状態.利用者.Google)) { b['券'] = 券; return 送る(b); }
    if (!global.FM) return Promise.reject(new Error('ログインしてください'));
    return global.FM.トークンをもらう().then(function (t) { b.idToken = t; return 送る(b); });
  }

  // ---------------------------------------------------------------- 画面
  function 幕を作る() {
    if (幕) return 幕;
    var st = document.createElement('style');
    st.textContent = '#mz-maku{position:fixed;inset:0;z-index:2147483000;overflow:auto;display:flex;align-items:flex-start;justify-content:center;padding:6vh 16px 40px;'
      + '--b:#F2F3F0;--s:#fff;--i:#191C1A;--m:#616A66;--r:#D8DDD6;--a:#24527A;--as:#E6EEF6;--n:#B0472F;--ns:#F7E9E4;background:var(--b);color:var(--i);font-family:"Noto Sans JP",system-ui,-apple-system,"Yu Gothic","Meiryo",sans-serif;font-size:14px;line-height:1.7}'
      + '@media (prefers-color-scheme:dark){#mz-maku{--b:#111412;--s:#191D1A;--i:#E8ECE8;--m:#9AA49F;--r:#2D3430;--a:#8FB6DA;--as:#1B2836;--n:#E2907A;--ns:#33211D}}'
      + '#mz-maku *{box-sizing:border-box}#mz-maku .bx{width:min(440px,100%);background:var(--s);border:1px solid var(--r);border-radius:3px;box-shadow:0 1px 2px rgba(0,0,0,.06),0 12px 32px -18px rgba(0,0,0,.4)}'
      + '#mz-maku .hd{padding:20px 24px 14px;border-bottom:1px solid var(--r)}#mz-maku h1{margin:0;font-family:"Shippori Mincho B1","Yu Mincho",serif;font-weight:600;font-size:24px;letter-spacing:.06em}'
      + '#mz-maku .sub{margin:2px 0 0;color:var(--m);font-size:12.5px}#mz-maku .bd{padding:18px 24px 22px;display:flex;flex-direction:column;gap:14px}'
      + '#mz-maku h2{margin:0;font-size:11px;font-weight:700;letter-spacing:.14em;color:var(--m)}#mz-maku label{display:block;font-size:12px;color:var(--m);margin-bottom:2px}'
      + '#mz-maku input{width:100%;font:inherit;font-size:15px;padding:8px 10px;border:1px solid var(--r);border-radius:3px;background:var(--s);color:var(--i)}#mz-maku input:focus{outline:2px solid var(--a);outline-offset:1px}'
      + '#mz-maku button.go{font:inherit;font-size:14px;font-weight:700;padding:9px 16px;border:1px solid var(--a);border-radius:3px;background:var(--a);color:var(--s);cursor:pointer;width:100%}#mz-maku button.go:disabled{opacity:.55;cursor:default}'
      + '#mz-maku button.lk{font:inherit;font-size:12.5px;border:0;background:none;color:var(--a);cursor:pointer;padding:0;text-decoration:underline}'
      + '#mz-maku .or{display:flex;align-items:center;gap:10px;color:var(--m);font-size:12px}#mz-maku .or:before,#mz-maku .or:after{content:"";flex:1;border-top:1px solid var(--r)}'
      + '#mz-maku .msg{padding:9px 12px;border:1px solid var(--n);background:var(--ns);color:var(--n);font-size:13px;border-radius:3px;display:none}#mz-maku .msg.on{display:block}#mz-maku .msg.info{border-color:var(--a);background:var(--as);color:var(--a)}'
      + '#mz-maku .ft{color:var(--m);font-size:12px;margin:0}#mz-maku form{display:flex;flex-direction:column;gap:10px;margin:0}#mz-g{min-height:40px}'
      + 'html.mz-wait body > .wrap{visibility:hidden !important}html.mz-wait,html.mz-wait body{overflow:hidden}'
      + '#mz-chip{display:inline-flex;flex-wrap:wrap;gap:4px 10px;align-items:center;font-size:12px;padding:3px 10px;border:1px solid var(--rule,#D8DDD6);border-radius:3px;background:var(--surface,#fff);color:var(--ink,#191C1A)}'
      + '#mz-chip b{font-weight:700}#mz-chip button,#mz-chip a{font:inherit;font-size:12px;border:0;background:none;color:var(--accent,#24527A);cursor:pointer;padding:0;text-decoration:underline}#mz-chip .off{color:var(--warn,#8A6712);font-weight:700}';
    document.head.appendChild(st);
    幕 = document.createElement('div'); 幕.id = 'mz-maku'; 幕.setAttribute('role', 'dialog'); 幕.setAttribute('aria-modal', 'true'); 幕.setAttribute('aria-label', 'ログイン');
    document.body.appendChild(幕); return 幕;
  }
  function 枠(title, sub, body) { return '<div class="bx"><div class="hd"><h1>' + esc(title) + '</h1><p class="sub">' + esc(sub) + '</p></div><div class="bd">' + body + '</div></div>'; }
  function 知らせ(text, info) { var m = document.getElementById('mz-msg'); if (!m) return; m.textContent = text || ''; m.className = 'msg' + (text ? ' on' : '') + (info ? ' info' : ''); }

  function ログイン画面(文) {
    var el = 幕を作る(); document.documentElement.classList.add('mz-wait'); el.style.display = 'flex';
    el.innerHTML = 枠(設定.題 || '折丁面付台', 設定.管理者だけ ? '公開設定（トキワ印刷 本多・福永）' : 'トキワ印刷グループ 面付ツール',
      '<div id="mz-msg" class="msg" role="alert"></div>'
      + '<div><h2>GOOGLE アカウントでログイン</h2><div id="mz-g" style="margin-top:8px"></div><p class="ft">登録してあるメールアドレスの Google アカウントを選んでください。<br><button class="lk" id="mz-gwin" type="button">ボタンが出ないときは、別の窓でログイン</button></p></div>'
      + (設定.管理者だけ ? '' : '<div class="or">または</div><form id="mz-f" autocomplete="on"><h2>ログインID とパスワード</h2>'
        + '<div><label for="mz-id">ログインID</label><input id="mz-id" name="username" autocomplete="username" autocapitalize="off" spellcheck="false" required></div>'
        + '<div><label for="mz-pw">パスワード</label><input id="mz-pw" name="password" type="password" autocomplete="current-password" required></div>'
        + '<button class="go" id="mz-go" type="submit">ログイン</button></form>')
      + '<p class="ft">使えるのは登録のある方だけです。登録・パスワードの出し直しは、トキワ印刷の本多・福永まで。</p>'
      + ((状態 && 状態.ゲスト) ? '<button class="lk" id="mz-skip" type="button">ログインせずに使う（内蔵のパターンだけ）</button>' : ''));
    知らせ(文 || '');
    var gw = document.getElementById('mz-gwin'); if (gw) gw.onclick = function () { try { global.FM.ログイン窓を開く(); 知らせ('別の窓でログインしてください。済むと、この画面は自動で進みます。', true); } catch (e) {} };
    var sk = document.getElementById('mz-skip'); if (sk) sk.onclick = function () { 幕を下ろす(); };
    if (global.FM) { try { global.FM.サインインのボタンを置く(document.getElementById('mz-g')); var g = document.getElementById('mz-g'); g.style.display = 'block'; } catch (e) {} }
    var f = document.getElementById('mz-f');
    if (f) f.addEventListener('submit', function (ev) {
      ev.preventDefault(); var id = document.getElementById('mz-id').value.trim(), pw = document.getElementById('mz-pw').value; if (!id || !pw) return;
      var b = document.getElementById('mz-go'); b.disabled = true; b.textContent = '確かめています…'; 知らせ('');
      送る({ action: '面付_入る', 'ログイン': id, 'パスワード': pw }).then(function (r) { document.getElementById('mz-pw').value = ''; 置く(券の置き場, r.券); 入った(r, false); })
        .catch(function (e) { b.disabled = false; b.textContent = 'ログイン'; document.getElementById('mz-pw').value = ''; 知らせ(通信の失敗か(e) ? '通信できませんでした。少し待ってからやり直してください' : String(e.message || e)); });
    });
  }
  function Googleで入る(静かに) {
    return global.FM.トークンをもらう().then(function (t) { return 送る({ action: '面付_入る', idToken: t }); }).then(function (r) { 置く(券の置き場, ''); 入った(r, false); })
      .catch(function (e) { if (通信の失敗か(e) && 前回で入る()) return; if (静かに && 状態 && 状態.ゲスト) return;   // LOGIN-LATER: 裏で試しただけのときは、だめでもログイン画面を出さない
        ログイン画面(静かに && /ログインが切れました|サインイン/.test(String(e.message)) ? '' : (通信の失敗か(e) ? '通信できませんでした。少し待ってからやり直してください' : String(e.message || e))); });
  }
  function 前回で入る() {   // 通信できないときだけ。ログインを断られたときには使わない
    try { var o = JSON.parse(読む(前回の置き場) || 'null'); if (!o || !o.at || Date.now() - o.at > 猶予 || !o.r || 設定.管理者だけ) return false; o.r.通信なし = true; 入った(o.r, true); return true; } catch (e) { return false; }
  }
  function パスワードを決める画面(r) {
    var el = 幕を作る(); document.documentElement.classList.add('mz-wait'); el.style.display = 'flex';
    el.innerHTML = 枠('パスワードを決める', (r.利用者.会社名 || '') + '　' + (r.利用者.名前 || r.利用者.ログイン),
      '<div id="mz-msg" class="msg info on">最初のログインです。これから使うパスワードを決めてください（8 文字以上・英字と数字）。</div>'
      + '<form id="mz-f"><input type="text" name="username" autocomplete="username" value="' + esc(r.利用者.ログイン) + '" readonly style="display:none">'
      + '<div><label for="mz-old">いまの（仮の）パスワード</label><input id="mz-old" type="password" autocomplete="current-password" required></div>'
      + '<div><label for="mz-new">新しいパスワード</label><input id="mz-new" type="password" autocomplete="new-password" minlength="8" required></div>'
      + '<div><label for="mz-new2">新しいパスワード（もう一度）</label><input id="mz-new2" type="password" autocomplete="new-password" minlength="8" required></div>'
      + '<button class="go" id="mz-go" type="submit">決める</button></form>' + (r.利用者.要変更 ? '' : '<button class="lk" id="mz-back" type="button">やめて戻る</button>'));
    if (!r.利用者.要変更) { 知らせ('新しいパスワードは 8 文字以上・英字と数字の両方を入れてください。', true); document.getElementById('mz-back').onclick = function () { 幕を下ろす(); }; }
    document.getElementById('mz-f').addEventListener('submit', function (ev) {
      ev.preventDefault(); var a = document.getElementById('mz-old').value, n1 = document.getElementById('mz-new').value, n2 = document.getElementById('mz-new2').value;
      if (n1 !== n2) { 知らせ('新しいパスワードが 2 つで違っています'); return; }
      var b = document.getElementById('mz-go'); b.disabled = true; b.textContent = '変えています…';
      送る({ action: '面付_パスワード変更', '券': 読む(券の置き場), '今の': a, '新しい': n1 }).then(function (x) { 置く(券の置き場, x.券); r.利用者.要変更 = false; 入った(r, false); })
        .catch(function (e) { b.disabled = false; b.textContent = '決める'; 知らせ(String(e.message || e)); });
    });
  }
  function 幕を下ろす() { if (幕) { 幕.style.display = 'none'; 幕.innerHTML = ''; } document.documentElement.classList.remove('mz-wait'); }

  function 入った(r, 前回) {
    if (設定.管理者だけ && !(r.利用者 && r.利用者.管理者 && r.利用者.Google)) { 状態 = null; ログイン画面('設定は トキワ印刷の本多・福永 だけです。Google アカウントでログインしてください'); return; }
    if (r.利用者 && r.利用者.要変更 && !前回) { 状態 = r; パスワードを決める画面(r); return; }
    状態 = r; if (!前回 && !r.ゲスト) 置く(前回の置き場, JSON.stringify({ at: Date.now(), r: r }));
    幕を下ろす(); 札を描く();
    if (typeof 設定.入った === 'function') { try { 設定.入った(r); } catch (e) { console.error('[面付ログイン]', e); } }
  }
  function 出る() {
    var 券 = 読む(券の置き場); var 後 = function () { 置く(券の置き場, ''); 置く(前回の置き場, ''); try { localStorage.removeItem('fm_id_token'); } catch (e) {} 状態 = null; location.reload(); };
    if (券) 送る({ action: '面付_出る', '券': 券 }).then(後, 後); else 後();
  }
  function 札を描く() {
    var el = document.getElementById('mz-chip'); if (!el) { var host = 設定.札の場所 && document.querySelector(設定.札の場所); if (!host) return; el = document.createElement('div'); el.id = 'mz-chip'; host.appendChild(el); }
    if (状態 && 状態.ゲスト) {   // LOGIN-LATER: ログインなしで使っているとき
      el.innerHTML = '<span title="正式運用までは、ログインなしで使えます。ログインすると、各社のパターンと登録が使えます">ログインなし</span><button type="button" id="mz-in">ログイン</button>';
      document.getElementById('mz-in').onclick = function () { ログイン画面(''); }; return; }
    var u = (状態 && 状態.利用者) || {}; var base = ''; try { var sc = document.querySelector('script[src*="menzuke-auth.js"]'); base = sc ? String(sc.getAttribute('src')).replace(/menzuke-auth\.js.*$/, '') : ''; } catch (e) {}
    el.innerHTML = '<span><b>' + esc(u.会社名 || '') + '</b>　' + esc(u.名前 || u.ログイン || '') + '</span>' + (状態.通信なし ? '<span class="off" title="中継と通信できないため、前回のログインで続けています。パターンは前回のものです">通信なし</span>' : '')
      + (u.管理者 && !設定.管理者だけ ? '<a href="' + base + 'menzuke-settei.html" target="_blank" rel="noopener">公開設定</a>' : '')
      + (!u.Google && !状態.通信なし ? '<button type="button" id="mz-pwc">パスワード変更</button>' : '') + '<button type="button" id="mz-out">ログアウト</button>';
    document.getElementById('mz-out').onclick = function () { if (confirm('ログアウトしますか？')) 出る(); };
    var c = document.getElementById('mz-pwc'); if (c) c.onclick = function () { パスワードを決める画面(状態); };
  }

  function 始める(o) {
    設定 = o || {}; 幕を作る(); document.documentElement.classList.add('mz-wait');
    幕.innerHTML = 枠(設定.題 || '折丁面付台', 'ログインを確かめています…', '<p class="ft">少しお待ちください。</p>');
    global.addEventListener('fm-signin', function (ev) { if ((状態 && !状態.ゲスト) || !(ev.detail && ev.detail.email)) return; Googleで入る(!!(状態 && 状態.ゲスト && !(幕 && 幕.innerHTML))); });   // Google のボタンでログインできたとき
    if (!正式運用 && !設定.管理者だけ) {   // LOGIN-LATER: まずログインなしで開き、前のログインが残っていれば裏で入り直す
      入った(ログインなしの状態(), true);
      var 券0 = 読む(券の置き場);
      if (券0) 送る({ action: '面付_入る', '券': 券0 }).then(function (r) { 入った(r, false); }).catch(function (e) { if (!通信の失敗か(e)) 置く(券の置き場, ''); });
      else if (global.FM && global.FM.名乗っている()) Googleで入る(true);
      return;
    }
    var 券 = 読む(券の置き場);
    if (券 && !設定.管理者だけ) { 送る({ action: '面付_入る', '券': 券 }).then(function (r) { 入った(r, false); }).catch(function (e) { if (通信の失敗か(e) && 前回で入る()) return; if (!通信の失敗か(e)) { 置く(券の置き場, ''); if (global.FM && global.FM.名乗っている()) { Googleで入る(true); return; } }   // 券が切れていても、Google でログイン済みならそちらで入る
      ログイン画面(通信の失敗か(e) ? '通信できませんでした。少し待ってからやり直してください' : String(e.message || e)); }); return; }
    if (global.FM && global.FM.名乗っている()) { Googleで入る(true); return; }
    ログイン画面('');
  }

  global.MZ = { 始める: 始める, 呼ぶ: 呼ぶ, 公開で読む: function (action) { return 送る({ action: action }); }, 出る: 出る, 状態: function () { return 状態; }, 通信の失敗か: 通信の失敗か,
    パターンを入れ替える: function (list) { if (状態) { 状態.パターン = list || []; if (!状態.通信なし) 置く(前回の置き場, JSON.stringify({ at: Date.now(), r: 状態 })); } } };
})(window);
