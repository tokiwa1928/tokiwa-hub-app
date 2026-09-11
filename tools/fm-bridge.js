/**
 * FileMaker への窓口（Hub のどのページからでも使う）
 *
 *   <script src="tools/fm-bridge.js"></script>   ← 本体（index.html）から
 *   <script src="fm-bridge.js"></script>          ← tools/ の中のページから
 *
 * 使い方
 *   await FM.呼ぶ('画面_読み込み', ['a108167'])
 *   await FM.呼ぶ('画面_一覧', [{ キーワード:'カレンダー', 件数:50 }])
 *   FM.サインインのボタンを置く(el)      サインインが要るときだけ出る
 *   FM.名乗っている()                     サインイン済みなら メールアドレス
 *
 * しくみ
 *   ページで Google のサインインをして受け取った ID トークンを、中継（Apps Script）に
 *   毎回そえて送る。中継はそれを Google に確かめ、社内のドメインでなければ何もしない。
 *   Hub は公開のページなので、FileMaker の鍵はここには置かない。
 *
 * 将来 FileMaker との連携を外すときは、この「呼ぶ」の中を
 * Hub 自身のデータに向けるだけでよい。呼ぶ側は何も変えなくて済む。
 */
(function (global) {
  'use strict';

  var 中継 = 'https://script.google.com/macros/s/'
           + 'AKfycby3DCpR4kCCQMBZ0a8sdsBArM1z_J3JJKcIMYNOHLlhzB1LNrYPqw_NM-dxo_JirSyK4g/exec';

  // GCP で作った OAuth クライアントID。秘密ではないのでページに書いてよい。
  // 承認済みの JavaScript 生成元: https://tokiwa1928.github.io ／ http://127.0.0.1:8765
  var クライアントID = '301364298857-pmt4p3fq440fh6hct3m8avcnlf11jos7.apps.googleusercontent.com';

  // 位置で渡す引数を、送信用に名前つきへ直す
  var 引数名 = {
    '画面_読み込み':       ['番号'],
    '画面_recordIdで読む': ['recordId'],
    '画面_保存':           ['recordId', 'modId', 'fields'],
    '画面_新規案件':       ['種別', '初期値'],
    '画面_新規段階':       ['案件ID', '種別'],
    '画面_一覧':           ['条件'],
    '写し_一覧':           ['条件'],
    '写し_読み込み':       ['番号'],
    '写し_状況':           [],
    'GEN_取り込み':        ['画面', '見出し', '鍵列', '行'],
    'GEN_一覧':            ['画面', '絞り込み', '件数'],
    'GEN_状況':            []
  };

  var 置き場 = 'fm_id_token';
  var トークン = '', 期限 = 0, 待っている = null, メール = '';
  var 置き場所 = [];   // サインインのボタンを出す場所

  function 中身を読む(jwt) {
    try {
      var p = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      return { exp: (p.exp || 0) * 1000, email: p.email || '' };
    } catch (e) { return { exp: 0, email: '' }; }
  }

  function 名乗る(jwt) {
    トークン = jwt;
    var p = 中身を読む(jwt);
    期限 = p.exp; メール = p.email;
    try { localStorage.setItem(置き場, jwt); } catch (e) {}
    置き場所.forEach(function (el) { el.style.display = 'none'; });
    知らせる();
    if (待っている) { var f = 待っている; 待っている = null; f(); }
  }

  function 忘れる() {
    トークン = ''; 期限 = 0; メール = '';
    try { localStorage.removeItem(置き場); } catch (e) {}
    置き場所.forEach(function (el) { el.style.display = 'inline-block'; });
    知らせる();
  }

  function 知らせる() {
    try {
      global.dispatchEvent(new CustomEvent('fm-signin', { detail: { email: メール } }));
    } catch (e) {}
  }

  function 覚えているものを使う() {
    if (トークン) return;
    var jwt = '';
    try { jwt = localStorage.getItem(置き場) || ''; } catch (e) {}
    if (!jwt) return;
    if (中身を読む(jwt).exp - Date.now() > 5 * 60 * 1000) 名乗る(jwt);
    else { try { localStorage.removeItem(置き場); } catch (e) {} }
  }

  function GISを待つ() {
    return new Promise(function (done, fail) {
      if (global.google && google.accounts && google.accounts.id) return done();
      var 残り = 100;
      var t = setInterval(function () {
        if (global.google && google.accounts && google.accounts.id) { clearInterval(t); done(); }
        else if (--残り <= 0) {
          clearInterval(t);
          fail(new Error('Google のサインインを読み込めませんでした（通信を確認してください）'));
        }
      }, 100);
    });
  }

  // gsi/client を一度だけ読み込む
  var 読込 = null;
  function GISを読む() {
    if (読込) return 読込;
    読込 = new Promise(function (done) {
      if (document.querySelector('script[src*="accounts.google.com/gsi/client"]')) return done();
      var s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true; s.defer = true;
      s.onload = function () { done(); };
      s.onerror = function () { done(); };
      document.head.appendChild(s);
    }).then(GISを待つ);
    return 読込;
  }

  var 用意 = null;
  function 用意する() {
    if (用意) return 用意;
    用意 = GISを読む().then(function () {
      google.accounts.id.initialize({
        client_id: クライアントID,
        auto_select: true,
        callback: function (res) { if (res && res.credential) 名乗る(res.credential); }
      });
      置き場所.forEach(描く);
      try { google.accounts.id.prompt(); } catch (e) {}
    });
    return 用意;
  }

  function 描く(el) {
    if (!el || el.getAttribute('data-fm-drawn')) return;
    el.setAttribute('data-fm-drawn', '1');
    el.style.display = トークン ? 'none' : 'inline-block';
    try {
      google.accounts.id.renderButton(el, { type: 'standard', size: 'small', text: 'signin' });
    } catch (e) {}
  }

  function トークンを得る() {
    覚えているものを使う();
    if (トークン && 期限 - Date.now() > 5 * 60 * 1000) return Promise.resolve(トークン);
    トークン = '';
    return 用意する().then(function () {
      if (トークン) return トークン;
      return new Promise(function (done, fail) {
        var 時間切れ = setTimeout(function () {
          待っている = null;
          置き場所.forEach(function (el) { el.style.display = 'inline-block'; });
          fail(new Error('サインインしてください。「ログイン」を押して社内のアカウントを選んでください'
                         + '（この画面が裏にあると Google の窓が出せません）'));
        }, 20000);
        待っている = function () { clearTimeout(時間切れ); done(トークン); };
        try { google.accounts.id.prompt(); } catch (e) {}
      });
    });
  }

  // 「Failed to fetch」は Google 側の一時的な失敗が多い。3回まで少し待って試し直す
  function 呼ぶ(name, args) {
    var 残り = 3;
    function 試す() {
      return 呼ぶ一回_(name, args).catch(function (e) {
        if (--残り > 0 && /Failed to fetch|NetworkError|Load failed/.test(String(e && e.message))) {
          return new Promise(function (r) { setTimeout(r, 1500); }).then(試す);
        }
        throw e;
      });
    }
    return 試す();
  }

  function 呼ぶ一回_(name, args) {
    var 名 = 引数名[name];
    if (!名) return Promise.reject(new Error('知らない操作です: ' + name));
    return トークンを得る().then(function (jwt) {
      var body = { action: name, idToken: jwt };
      名.forEach(function (k, i) { body[k] = (args || [])[i]; });
      return fetch(中継, {
        method: 'POST',
        // text/plain にすると事前確認（preflight）が飛ばない。
        // Apps Script は OPTIONS に答えられないので、これが要る。
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body),
        redirect: 'follow'
      });
    }).then(function (res) {
      return res.text().then(function (t) {
        var r;
        try { r = JSON.parse(t); }
        catch (e) { throw new Error('中継の返事を読めませんでした（' + res.status + '）'); }
        if (!r.ok) {
          if (/サインイン|この画面あて/.test(r.error || '')) 忘れる();
          throw new Error(r.error || '不明なエラー');
        }
        return r.data;
      });
    });
  }

  global.FM = {
    呼ぶ: 呼ぶ,
    名乗っている: function () { 覚えているものを使う(); return メール; },
    サインインのボタンを置く: function (el) {
      if (!el) return;
      if (置き場所.indexOf(el) < 0) 置き場所.push(el);
      el.style.display = トークン ? 'none' : 'inline-block';
      用意する().then(function () { 描く(el); }).catch(function () {});
    },
    // 押されたときにサインインを始める（開いた瞬間に窓を出したくない画面向け）
    ようい: function () { return 用意する(); }
  };

  覚えているものを使う();
})(window);
