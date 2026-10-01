/* HUB-NAV（本多さん 10/2「ツールを使ったらダッシュボードに戻れる仕組みを。ただし URL で直接ツールに入ったときは他のところに行けないように」）
   ・Hub から開いたとき（?hub=1 か、Hub からの遷移）: 上に「← Tokiwa Hub に戻る」の細い帯を出す。同じタブ内の移動でも覚えておく（sessionStorage）
   ・直接 URL で開いたとき（関連会社にツールだけ配っている段階）: Hub や他のツールへのリンクを隠す。ツールだけで完結する
   使い方: 各ツールの </head> の前で <script src="hub-nav.js"></script>（index.html からは tools/… の形で開く） */
(function () {
  try {
    var q = new URLSearchParams(location.search);
    var fromHub = q.get('hub') === '1' || (document.referrer && /\/(index\.html)?(\?|#|$)/.test(document.referrer.replace(/^https?:\/\/[^/]+\/(tokiwa-hub-app\/)?/, '/')) && !/\/tools\//.test(document.referrer));
    var remembered = sessionStorage.getItem('tokiwa_hub_nav') === '1';
    if (fromHub) sessionStorage.setItem('tokiwa_hub_nav', '1');
    var inHub = fromHub || remembered;
    var hubHref = (function () { var p = location.pathname; return /\/tools\//.test(p) ? '../index.html' : 'index.html'; })();
    function ready(fn) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn); else fn(); }
    ready(function () {
      if (inHub) {
        if (document.getElementById('hub-nav-bar')) return;
        var bar = document.createElement('div'); bar.id = 'hub-nav-bar';
        bar.style.cssText = 'position:sticky;top:0;z-index:9999;display:flex;align-items:center;gap:12px;padding:6px 14px;background:#2E3D35;color:#fff;font-size:12.5px;font-family:"Zen Kaku Gothic New","Hiragino Sans","Yu Gothic",system-ui,sans-serif;border-bottom:1px solid #1f2b25';
        var name = (document.title || '').replace(/\s*\|.*$/, '').replace(/\s*[-–—]\s*Tokiwa Hub.*$/, '');
        bar.innerHTML = '<a href="' + hubHref + '" style="color:#fff;text-decoration:none;font-weight:700;display:inline-flex;align-items:center;gap:6px">← Tokiwa Hub に戻る</a>'
          + '<span style="opacity:.55">｜</span><span style="opacity:.9">' + name.replace(/[<>&]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]; }) + '</span>'
          + '<a href="' + hubHref + '?page=tools" style="margin-left:auto;color:#cfe3d6;text-decoration:none;font-size:12px">🧰 ほかのツール</a>';
        document.body.insertBefore(bar, document.body.firstChild);
      } else {
        // ツール単体モード: Hub・他のツールへのリンクを隠す（同じページ内の # と外部 http は残す）
        var hide = function (a) { a.style.display = 'none'; a.setAttribute('data-hub-hidden', '1'); };
        Array.prototype.forEach.call(document.querySelectorAll('a[href]'), function (a) {
          var h = a.getAttribute('href') || ''; if (!h || h.charAt(0) === '#' || /^(https?:|mailto:|tel:|javascript:)/i.test(h)) return;
          if (/index\.html/.test(h) || /\.html(\?|#|$)/.test(h)) hide(a);
        });
        document.documentElement.setAttribute('data-hub-standalone', '1');
      }
    });
  } catch (e) {}
})();
