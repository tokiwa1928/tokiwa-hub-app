// HUBAUTH-1（2026-11-19）: Hub（会社 GAS）への通信に、社内の Google ログイン（ID トークン）を自動でそえる。
//   Hub のページは公開の場所にあるので、合言葉（apiKey）をページに書くと誰でも DB を読めてしまう。
//   そこで、会社 GAS あての fetch を横取りして apiKey を外し、idToken（FileMaker 連携と同じサインイン）を付ける。
//   サインインは fm-bridge.js（FM.トークンをもらう）に任せる。まだなら Google の窓／「ログインする」の帯が出る。
//   各ページの <head> の最初で読む: <script src="tools/hub-auth.js"></script>（tools/ の中のページは src="hub-auth.js"）
(function (g) {
  'use strict';
  if (g.__hubAuth) return; g.__hubAuth = true;
  var HUB = /AKfycbw9-8Nnq3jV9lCDUEf7JOvQM/;   // 会社 GAS（Hub 本体）の配備
  var 置き場 = 'fm_id_token';                   // fm-bridge.js と同じ
  var 元 = (document.currentScript && document.currentScript.src || '').replace(/hub-auth\.js.*$/, '');

  function 期限(jwt) {
    try { return JSON.parse(atob(String(jwt).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp * 1000; } catch (e) { return 0; }
  }
  function 手元の() {
    try { var j = localStorage.getItem(置き場) || ''; if (j && 期限(j) - Date.now() > 2 * 60 * 1000) return j; } catch (e) {}
    return '';
  }
  function 窓口のFM(w) { try { return w && w.FM && typeof w.FM.トークンをもらう === 'function' ? w.FM : null; } catch (e) { return null; } }

  var 読込中 = null;
  function FMを用意() {
    var f = 窓口のFM(g); if (f) return Promise.resolve(f);
    try { if (g.parent !== g) { f = 窓口のFM(g.parent) || 窓口のFM(g.top); if (f) return Promise.resolve(f); } } catch (e) {}
    if (読込中) return 読込中;
    読込中 = new Promise(function (done) {
      var 待つ = function (n) { var x = 窓口のFM(g); if (x) return done(x); if (n <= 0) return done(null); setTimeout(function () { 待つ(n - 1); }, 100); };
      if (document.querySelector('script[src*="fm-bridge.js"]')) return 待つ(150);   // ページが自分で読んでいる（defer など）
      var s = document.createElement('script'); s.src = 元 + 'fm-bridge.js';
      s.onload = function () { 待つ(30); }; s.onerror = function () { done(null); };
      (document.head || document.documentElement).appendChild(s);
    });
    return 読込中;
  }
  var 取得中 = null;
  function トークン() {
    var t = 手元の(); if (t) return Promise.resolve(t);
    if (取得中) return 取得中;
    取得中 = FMを用意().then(function (f) { return f ? f.トークンをもらう() : ''; }).catch(function () { return ''; })
      .then(function (x) { 取得中 = null; return x || 手元の(); });
    return 取得中;
  }

  // HUBAUTH-2（11/19 本多さん「問い合わせにちゃんとメールが入ってない」）: ログインが切れて Hub が断ったとき、
  //   黙って古い控えを出し続けないよう、上に赤い帯を出す。ログインし直すと（別の窓でも）この画面を読み直す
  var 帯を出した = false;
  function 切れた帯() {
    if (帯を出した) return; 帯を出した = true;
    var 出す = function () {
      if (!document.body || document.getElementById('hub-auth-help')) return;
      var d = document.createElement('div'); d.id = 'hub-auth-help';
      d.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:2147483001;background:#b91c1c;color:#fff;padding:9px 14px;font:700 14px/1.5 "Hiragino Sans","Yu Gothic UI","Meiryo",sans-serif;display:flex;gap:12px;align-items:center;flex-wrap:wrap';
      d.innerHTML = '<span>Hub のログインが切れています。いま出ている問い合わせ・案件は古いままです。</span><button type="button" style="font:inherit;padding:4px 16px;border:0;border-radius:6px;background:#fff;color:#b91c1c;cursor:pointer">ログインする</button><span style="font-weight:400;font-size:12px">社内の Google アカウントで。ログインできたら自動で読み直します</span>';
      d.querySelector('button').onclick = function () {
        FMを用意().then(function (f) { if (f && f.ログイン窓を開く) f.ログイン窓を開く(); else g.open(元 + 'fm-signin.html', 'fm_signin', 'width=460,height=420'); });
      };
      document.body.appendChild(d);
    };
    if (document.body) 出す(); else document.addEventListener('DOMContentLoaded', 出す);
    function 読み直す() {   // 読み直しは 2 分に 1 回まで（同じトークンで断られ続けても、くり返し読み直さない）
      try { var last = Number(sessionStorage.getItem('hub_auth_reload') || 0); if (Date.now() - last < 2 * 60 * 1000) return; sessionStorage.setItem('hub_auth_reload', String(Date.now())); } catch (x) {}
      try { (g.top || g).location.reload(); } catch (x) { location.reload(); }
    }
    try { g.addEventListener('storage', function (e) { if (e && e.key === 置き場 && e.newValue && 期限(e.newValue) - Date.now() > 2 * 60 * 1000) 読み直す(); }); } catch (e) {}
    try { g.addEventListener('fm-signin', function (e) { if (e && e.detail && e.detail.email) 読み直す(); }); } catch (e) {}
  }
  function 断られたか(res) {
    try {
      return res.clone().text().then(function (t) {
        if (/"error"\s*:\s*"(sign_in_required|sign_in_expired|not_company_account|invalid_api_key)"/.test(t.slice(0, 300))) {
          try { localStorage.removeItem(置き場); } catch (e) {}
          切れた帯();
        }
      }).catch(function () {});
    } catch (e) {}
  }

  var 元のfetch = g.fetch && g.fetch.bind(g);
  if (!元のfetch) return;
  g.fetch = function (input, init) {
    var url = '';
    try { url = typeof input === 'string' ? input : (input instanceof URL ? input.href : (input && input.url) || ''); } catch (e) {}
    if (!url || !HUB.test(url)) return 元のfetch(input, init);
    return トークン().then(function (t) {
      var u = new URL(url, location.href);
      u.searchParams.delete('apiKey');
      if (t) u.searchParams.set('idToken', t); else 切れた帯();
      var p = (input && typeof input === 'object' && !(input instanceof URL)) ? 元のfetch(new Request(u.toString(), input), init) : 元のfetch(u.toString(), init);
      return p.then(function (res) { 断られたか(res); return res; });
    });
  };
  g.HubAuth = { トークン: トークン, 名前: function () { var t = 手元の(); try { return t ? JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).email : ''; } catch (e) { return ''; } } };
})(window);
