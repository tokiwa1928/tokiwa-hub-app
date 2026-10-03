// LINE WORKS の側: Hub が開いたノートの URL に #hubcat=カテゴリー名 が付いていたら、「移動」→ カテゴリー → OK を代わりに押す
//   ・Hub は https://talk.worksmobile.com/note/<チャンネル番号>/<ノート番号>#hubcat=... で開く
//   ・LINE WORKS の画面の作り（div.btn_move_wrap > button.btn_more、.ly_move_posts > ul.posts_list li a、div.move_btns button、
//     移動後の「投稿を移動しました」の窓 div.ly_inform a.btn_confirm）が変わると動かない。そのときは赤い帯で知らせる
//   ・ボタンは「触れてから押す」（mouseover を先に送らないと React 側が反応しない）
(function () {
  var KEY = 'tokiwaHubCat';
  function readWish() {
    try {
      var m = /[#&]hubcat=([^&]+)/.exec(location.hash || '');
      if (m) { var w = { cat: decodeURIComponent(m[1]), post: (location.pathname.match(/\/note\/\d+\/(\d+)/) || [])[1] || '', at: Date.now() }; sessionStorage.setItem(KEY, JSON.stringify(w)); return w; }
      var s = sessionStorage.getItem(KEY); if (!s) return null; var o = JSON.parse(s); if (Date.now() - o.at > 120000) return null;
      var cur = (location.pathname.match(/\/note\/\d+\/(\d+)/) || [])[1] || ''; return (o.post && cur && o.post !== cur) ? null : o;
    } catch (e) { return null; }
  }
  var wish = readWish(); if (!wish || !wish.cat) return;
  var norm = function (s) { return String(s || '').replace(/\s+/g, '').replace(/[（）]/g, function (c) { return c === '（' ? '(' : ')'; }); };
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var shown = function (el) { return !!(el && el.getClientRects().length && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden'); };
  var hover = function (el) { ['mouseover', 'mouseenter', 'mousemove'].forEach(function (tp) { el.dispatchEvent(new MouseEvent(tp, { bubbles: true, view: window })); }); };
  var press = function (el) { hover(el); el.click(); };
  var banner = null;
  function say(text, color) {
    if (!banner) { banner = document.createElement('div'); banner.id = 'tokiwa-hub-banner'; banner.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:2147483647;padding:12px 18px;font:700 15px/1.5 "Zen Kaku Gothic New","Hiragino Sans","Yu Gothic",system-ui,sans-serif;color:#fff;box-shadow:0 2px 8px rgba(0,0,0,.25)'; (document.body || document.documentElement).appendChild(banner); }
    banner.style.background = color; banner.textContent = text;
  }
  async function waitFor(fn, ms) { var t0 = Date.now(); while (Date.now() - t0 < ms) { var v = fn(); if (v) return v; await sleep(250); } return null; }
  async function pressUntil(el, test, tries) {
    for (var i = 0; i < tries; i++) {
      press(el); await sleep(450); if (test()) return true;
      ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(function (tp) { el.dispatchEvent(new MouseEvent(tp, { bubbles: true, cancelable: true, view: window })); }); await sleep(450); if (test()) return true;
      await sleep(700);
    }
    return test();
  }
  function wrap() { var b = document.querySelector('div.btn_move_wrap button.btn_more'); return b ? b.closest('div.btn_move_wrap') : null; }
  function layer() { var w = wrap(); return w ? w.querySelector('.ly_move_posts') : null; }
  function checkedNow() { var l = layer(); var a = l ? Array.prototype.filter.call(l.querySelectorAll('ul.posts_list li a'), function (x) { return x.classList.contains('checked'); })[0] : null; return a ? a.textContent.trim() : ''; }
  function informOk() { var w = wrap(); return Array.prototype.filter.call(document.querySelectorAll('.ly_inform a.btn_confirm, .ly_inform button, .inform_btns a, .inform_btns button'), function (b) { return shown(b) && /^(OK|確認|はい)$/.test(b.textContent.trim()) && !(w && w.contains(b)); })[0] || null; }
  async function run() {
    say('Tokiwa Hub: カテゴリーを「' + wish.cat + '」に付け替えています…', '#2E3D35');
    var btn = await waitFor(function () { var b = document.querySelector('div.btn_move_wrap button.btn_more'); return shown(b) ? b : null; }, 20000);
    if (!btn) return fail('「移動」のボタンが見つかりません');
    await sleep(1000);   // 画面の準備が終わるまで少し待つ
    if (!(await pressUntil(btn, function () { return shown(layer()); }, 4))) return fail('「移動」の一覧が開きません');
    var items = Array.prototype.slice.call(layer().querySelectorAll('ul.posts_list li a'));
    var target = items.filter(function (a) { return norm(a.textContent) === norm(wish.cat); })[0];
    if (!target) return fail('カテゴリー「' + wish.cat + '」が一覧にありません（名前が LINE WORKS と違います）');
    if (target.classList.contains('checked')) {   // もうそのカテゴリー
      var cancel0 = Array.prototype.filter.call(layer().querySelectorAll('div.move_btns button'), function (b) { return b.textContent.trim() === 'キャンセル'; })[0]; if (cancel0) press(cancel0);
      return done('もともと「' + wish.cat + '」でした');
    }
    if (!(await pressUntil(target, function () { return target.classList.contains('checked'); }, 3))) return fail('カテゴリーを選べませんでした');
    var okBtn = Array.prototype.filter.call(layer().querySelectorAll('div.move_btns button'), function (b) { return /^(OK|確認)$/.test(b.textContent.trim()); })[0];
    if (!okBtn) return fail('OK のボタンが見つかりません');
    press(okBtn);
    // 「投稿を移動しました。」の窓 → OK
    var inf = await waitFor(informOk, 10000);
    if (inf) { press(inf); await sleep(500); }
    // 確かめる: 一覧（開いたまま or 開き直す）で選ばれているもの
    if (!shown(layer())) await pressUntil(btn, function () { return shown(layer()); }, 3);
    var now = checkedNow();
    var cancel = shown(layer()) ? Array.prototype.filter.call(layer().querySelectorAll('div.move_btns button'), function (b) { return b.textContent.trim() === 'キャンセル'; })[0] : null; if (cancel) press(cancel);
    if (now && norm(now) !== norm(wish.cat)) return fail('付け替えたはずですが、いまのカテゴリーは「' + now + '」です');
    if (!now && !inf) return fail('付け替えられたか確かめられませんでした');
    return done('カテゴリーを「' + wish.cat + '」に付け替えました');
  }
  async function done(msg) {
    try { sessionStorage.removeItem(KEY); } catch (e) { }
    say('Tokiwa Hub: ' + msg + '。このタブは閉じます', '#15743A');
    await sleep(1500); window.close(); await sleep(800);
    say('Tokiwa Hub: ' + msg + '。このタブは閉じて構いません', '#15743A');
  }
  function fail(why) { try { sessionStorage.removeItem(KEY); } catch (e) { } say('Tokiwa Hub: 自動で付け替えられませんでした（' + why + '）。手で「移動」からカテゴリーを「' + wish.cat + '」にしてください', '#B42318'); }
  function start() { run().catch(function (e) { fail(String(e && e.message || e)); }); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
