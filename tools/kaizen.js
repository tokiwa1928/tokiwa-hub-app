/**
 * 💡 気づいた ── 使いながら直すための部品
 *
 * どのページにも2行入れるだけ。
 *   <script>window.KAIZEN_KEY = 'juchu-fm';</script>
 *   <script src="kaizen.js"></script>
 *
 * 画面の説明は tools/kinou.json に1か所だけ書く。
 * ここと tools/kaizen.html の機能一覧が同じものを読むので、説明が食い違わない。
 * （その場で書きたいときは window.KAIZEN に直接オブジェクトを入れてもよい）
 *
 * 出るもの
 *   ・画面の隅に「💡 気づいた」のボタン
 *   ・押すと開く小窓に3つ
 *       1 この画面でできること   ← 説明はここに置く。人が口で説明しなくて済むように
 *       2 気づいたことを送る     ← 使いにくい所を、その場で一言残す
 *       3 最近直したこと         ← changelog.json から。直したことが使う人に伝わるように
 *
 * 残る場所
 *   Hub の共有データ（murayama_v15 の kaizen）。全社クラウドにも上げるので、
 *   誰が書いても本多さんの画面に出る。tools/kaizen.html で一覧・対応済みにできる。
 */
(function () {
  'use strict';

  var 画面 = window.KAIZEN || {};
  var 鍵 = window.KAIZEN_KEY || '';
  var DBKEY = 'murayama_v15';
  var AUTHKEY = 'murayama_auth';
  var GAS = 'https://script.google.com/a/macros/tokiwap-group.com/s/'
          + 'AKfycbw9-8Nnq3jV9lCDUEf7JOvQM_yAy1ZYnOIab-TYP3TZ-BtH7RosxKSeXmr-FvkxMVhv/exec';
  var KEY = 'mitsumori-2024';
  var BASE = location.pathname.indexOf('/tools/') >= 0 ? '../' : './';

  function db() { try { return JSON.parse(localStorage.getItem(DBKEY)) || null; } catch (e) { return null; } }
  function auth() { try { return JSON.parse(localStorage.getItem(AUTHKEY)) || {}; } catch (e) { return {}; } }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ---------------------------------------------------------- 見た目

  var css = document.createElement('style');
  css.textContent = [
    '#kz-btn{position:fixed;left:16px;bottom:16px;z-index:99998;display:inline-flex;align-items:center;',
    ' gap:6px;padding:9px 14px;font-size:13px;font-weight:700;line-height:1;cursor:pointer;',
    ' font-family:inherit;color:#0f172a;background:#fef08a;border:1px solid #ca8a04;',
    ' border-radius:22px;box-shadow:0 3px 10px rgba(0,0,0,.22);}',
    '#kz-btn:hover{background:#fde047;}',
    '#kz-panel{position:fixed;left:16px;bottom:62px;z-index:99999;width:min(400px,calc(100vw - 32px));',
    ' max-height:74vh;overflow:auto;background:#fff;color:#1a1a1a;border:1px solid #cbd5e1;',
    ' border-radius:12px;box-shadow:0 10px 34px rgba(0,0,0,.28);padding:14px 16px 16px;',
    ' display:none;font-size:13px;line-height:1.75;text-align:left;',
    ' font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Hiragino Kaku Gothic ProN","Yu Gothic",Meiryo,sans-serif;}',
    '#kz-panel h4{margin:0 0 6px;font-size:13px;color:#0369a1;letter-spacing:.02em;}',
    '#kz-panel h4:not(:first-child){margin-top:16px;padding-top:14px;border-top:1px solid #e2e8f0;}',
    '#kz-panel .nm{font-size:15px;font-weight:800;margin:0 0 2px;}',
    '#kz-panel .ds{color:#475569;margin:0 0 8px;}',
    '#kz-panel ul{margin:0;padding-left:18px;}',
    '#kz-panel li{margin:2px 0;}',
    '#kz-panel textarea{width:100%;min-height:74px;font:inherit;padding:8px 9px;border:1px solid #cbd5e1;',
    ' border-radius:7px;resize:vertical;box-sizing:border-box;}',
    '#kz-panel .row{display:flex;gap:8px;align-items:center;margin-top:8px;}',
    '#kz-panel button.send{font:inherit;font-weight:700;font-size:13px;padding:7px 16px;border-radius:8px;',
    ' border:0;background:#0369a1;color:#fff;cursor:pointer;}',
    '#kz-panel button.send:disabled{opacity:.5;cursor:default;}',
    '#kz-panel button.close{margin-left:auto;font:inherit;font-size:12px;padding:6px 12px;border-radius:8px;',
    ' border:1px solid #cbd5e1;background:#fff;color:#475569;cursor:pointer;}',
    '#kz-panel .hint{font-size:11.5px;color:#94a3b8;margin-top:6px;}',
    '#kz-panel .log .d{font-weight:700;color:#0369a1;margin:8px 0 2px;font-size:12px;}',
    '#kz-panel .ok{color:#15803d;font-weight:700;}',
    '#kz-panel .ng{color:#b91c1c;font-weight:700;}',
    '@media print{#kz-btn,#kz-panel{display:none !important;}}'
  ].join('');
  document.head.appendChild(css);

  var btn = document.createElement('button');
  btn.id = 'kz-btn';
  btn.type = 'button';
  btn.innerHTML = '💡 気づいた';
  btn.title = '使いにくい所を、その場で一言残せます';

  var panel = document.createElement('div');
  panel.id = 'kz-panel';

  document.body.appendChild(btn);
  document.body.appendChild(panel);

  // ---------------------------------------------------------- 中身

  function できることHTML() {
    var h = '';
    h += '<h4>この画面でできること</h4>';
    h += '<div class="nm">' + esc(画面['名前'] || document.title || 'この画面') + '</div>';
    if (画面['説明']) h += '<div class="ds">' + esc(画面['説明']) + '</div>';
    var l = 画面['できること'];
    if (l && l.length) {
      h += '<ul>' + l.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
    }
    if (画面['注意']) {
      h += '<div class="ds" style="margin-top:8px;color:#92400e">⚠ ' + esc(画面['注意']) + '</div>';
    }
    return h;
  }

  function 書く欄HTML() {
    var a = auth();
    return '<h4>気づいたことを送る</h4>'
      + '<textarea id="kz-text" placeholder="例: 得意先を入れたあと担当者に飛んでほしい／保存したのに一覧が古いまま"></textarea>'
      + '<div class="row">'
      + '  <button class="send" id="kz-send">送る</button>'
      + '  <span id="kz-msg" style="font-size:12px"></span>'
      + '  <button class="close" id="kz-close">閉じる</button>'
      + '</div>'
      + '<div class="hint">' + (a.userName ? esc(a.userName) + ' として送ります。' : '')
      + '画面の名前と、いま開いている番号も一緒に残ります。直したら「最近直したこと」に出ます。</div>';
  }

  function 開いている番号() {
    var 候補 = ['fm-no', 'f-denpyo', 'denpyo'];
    for (var i = 0; i < 候補.length; i++) {
      var el = document.getElementById(候補[i]);
      if (el && el.value) return String(el.value).trim();
    }
    try {
      var q = new URLSearchParams(location.search).get('no');
      if (q) return q;
    } catch (e) {}
    return '';
  }

  function 直したことを出す() {
    var box = panel.querySelector('#kz-log');
    if (!box) return;
    fetch(BASE + 'changelog.json?ts=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (list) {
        var 出す = (list || []).slice(0, 3);
        box.innerHTML = 出す.map(function (e) {
          return '<div class="d">' + esc(e.date) + '</div><ul>'
               + (e.items || []).map(function (i) { return '<li>' + i + '</li>'; }).join('')
               + '</ul>';
        }).join('') || '<div class="ds">まだありません</div>';
      })
      .catch(function () { box.innerHTML = '<div class="ds">取得できませんでした</div>'; });
  }

  function 描く() {
    panel.innerHTML = できることHTML() + 書く欄HTML()
      + '<h4>最近直したこと</h4><div class="log" id="kz-log">読み込み中…</div>';
    panel.querySelector('#kz-close').onclick = function () { panel.style.display = 'none'; };
    panel.querySelector('#kz-send').onclick = 送る;
    panel.querySelector('#kz-text').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) 送る();
    });
    直したことを出す();
  }

  // ---------------------------------------------------------- 送る

  function 送る() {
    var ta = panel.querySelector('#kz-text');
    var msg = panel.querySelector('#kz-msg');
    var 本文 = (ta.value || '').trim();
    if (!本文) { msg.className = 'ng'; msg.textContent = '中身を書いてください'; ta.focus(); return; }

    var a = auth();
    var rec = {
      id: 'kz_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      画面: 画面['名前'] || document.title || '',
      場所: location.pathname + location.search,
      番号: 開いている番号(),
      本文: 本文,
      書いた人: a.userName || '',
      会社: a.companyName || '',
      状態: '未対応',
      createdAt: new Date().toISOString(),
      _updatedAt: new Date().toISOString()
    };

    var d = db();
    if (!d) {
      // 本体にログインしていない端末。消えないよう、この端末に貯めておく
      try {
        var 控え = JSON.parse(localStorage.getItem('kaizen_hikae') || '[]');
        控え.push(rec);
        localStorage.setItem('kaizen_hikae', JSON.stringify(控え));
        msg.className = 'ok';
        msg.textContent = '✓ この端末に控えました（Hub にログインすると送られます）';
        ta.value = '';
      } catch (e) {
        msg.className = 'ng'; msg.textContent = '保存できませんでした';
      }
      return;
    }

    if (!Array.isArray(d.kaizen)) d.kaizen = [];
    d.kaizen.push(rec);
    try { localStorage.setItem(DBKEY, JSON.stringify(d)); }
    catch (e) { msg.className = 'ng'; msg.textContent = '端末に保存できませんでした'; return; }

    msg.className = ''; msg.textContent = '送っています…';
    panel.querySelector('#kz-send').disabled = true;

    雲へ上げる().then(function (ok) {
      panel.querySelector('#kz-send').disabled = false;
      msg.className = ok ? 'ok' : '';
      msg.textContent = ok ? '✓ 送りました。ありがとうございます'
                           : '✓ 端末に保存しました（次の同期で送られます）';
      ta.value = '';
      setTimeout(function () { panel.style.display = 'none'; msg.textContent = ''; }, 1800);
    });
  }

  // 全社クラウドへ。kaizen だけを新しい方で混ぜ、他はクラウドの最新をそのまま返す
  function 雲へ上げる() {
    var a = auth();
    if (!a.loggedIn || !a.companyId) return Promise.resolve(false);
    var u = new URL(GAS);
    u.searchParams.set('action', 'syncAll');
    u.searchParams.set('apiKey', KEY);
    u.searchParams.set('companyId', a.companyId);
    return fetch(u.toString(), { method: 'GET', redirect: 'follow' })
      .then(function (r) { return r.json(); })
      .then(function (r) { return (r && (r.data || r)) || null; })
      .catch(function () { return null; })
      .then(function (cloud) {
        var d = db(); if (!d) return false;
        var data;
        if (cloud && typeof cloud === 'object') {
          data = Object.assign({}, cloud);
          data.kaizen = 混ぜる(d.kaizen || [], cloud.kaizen || []);
          d.kaizen = data.kaizen;
          try { localStorage.setItem(DBKEY, JSON.stringify(d)); } catch (e) {}
        } else {
          return false;   // クラウドが読めないときは端末に置いたままにする
        }
        var p = new URL(GAS);
        p.searchParams.set('action', 'saveAll');
        p.searchParams.set('apiKey', KEY);
        return fetch(p.toString(), {
          method: 'POST',
          body: JSON.stringify({ companyId: a.companyId, data: data }),
          redirect: 'follow'
        }).then(function (r) { return r.json(); })
          .then(function (r) { return !!(r && r.success); })
          .catch(function () { return false; });
      });
  }

  function 混ぜる(こちら, あちら) {
    var 見た = {}, 出す = [];
    (あちら || []).concat(こちら || []).forEach(function (r) {
      if (!r || !r.id || 見た[r.id]) return;
      見た[r.id] = true; 出す.push(r);
    });
    return 出す;
  }

  // ログインしていない端末に貯まっていた分を、ログイン後に送る
  (function 控えを送る() {
    var 控え = [];
    try { 控え = JSON.parse(localStorage.getItem('kaizen_hikae') || '[]'); } catch (e) {}
    if (!控え.length) return;
    var d = db(), a = auth();
    if (!d || !a.loggedIn) return;
    if (!Array.isArray(d.kaizen)) d.kaizen = [];
    d.kaizen = 混ぜる(d.kaizen.concat(控え), []);
    try {
      localStorage.setItem(DBKEY, JSON.stringify(d));
      localStorage.removeItem('kaizen_hikae');
    } catch (e) { return; }
    雲へ上げる();
  })();

  // 画面の説明を kinou.json から取る（window.KAIZEN が直接与えられていれば、そちらが勝つ）
  var 機能メモ = (BASE === '../') ? 'kinou.json' : 'tools/kinou.json';
  var 説明の用意 = Promise.resolve();
  if (鍵 && !画面['名前']) {
    説明の用意 = fetch(機能メモ + '?ts=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { if (j && j[鍵]) 画面 = j[鍵]; })
      .catch(function () {});
  }

  btn.onclick = function () {
    if (panel.style.display === 'block') { panel.style.display = 'none'; return; }
    説明の用意.then(function () {
      描く();
      panel.style.display = 'block';
      var ta = panel.querySelector('#kz-text'); if (ta) ta.focus();
    });
  };
})();
