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

  var 元のfetch = g.fetch && g.fetch.bind(g);
  if (!元のfetch) return;
  g.fetch = function (input, init) {
    var url = '';
    try { url = typeof input === 'string' ? input : (input instanceof URL ? input.href : (input && input.url) || ''); } catch (e) {}
    if (!url || !HUB.test(url)) return 元のfetch(input, init);
    return トークン().then(function (t) {
      var u = new URL(url, location.href);
      u.searchParams.delete('apiKey');
      if (t) u.searchParams.set('idToken', t);
      if (input && typeof input === 'object' && !(input instanceof URL)) return 元のfetch(new Request(u.toString(), input), init);
      return 元のfetch(u.toString(), init);
    });
  };
  g.HubAuth = { トークン: トークン, 名前: function () { var t = 手元の(); try { return t ? JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).email : ''; } catch (e) { return ''; } } };
})(window);
