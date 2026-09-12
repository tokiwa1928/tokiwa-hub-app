# -*- coding: utf-8 -*-
"""受注入力（tools/fm-juchu.html）に「FileMaker とつなぐ」ぶんを足して組み立てる。

   元の画面には手を入れず、末尾に足すだけにする。元を直したらこれを流し直せばよい。

     python tools/fm-relay/build_juchu.py

   出るもの
     tools/fm-relay/juchu.html   Apps Script が配る版（google.script.run で呼ぶ）
     tools/fm-juchu-hub.html     Hub に置く版（Google サインイン＋fetch で呼ぶ）

   中身は同じで、中継の呼び方だけが違う。将来 FileMaker との連携を外すときは
   「呼ぶ」の中を差し替えるだけで、画面はそのまま使える。
"""
import os, sys, io

if hasattr(sys.stdout, 'buffer'):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8',
                                  errors='replace', line_buffering=True)

HERE = os.path.dirname(os.path.abspath(__file__))
SRC  = os.path.join(HERE, '..', 'fm-juchu.html')
DST_GAS = os.path.join(HERE, 'juchu.html')
DST_HUB = os.path.join(HERE, '..', 'fm-juchu-hub.html')

WEBAPP = ('https://script.google.com/macros/s/'
          'AKfycby3DCpR4kCCQMBZ0a8sdsBArM1z_J3JJKcIMYNOHLlhzB1LNrYPqw_NM-dxo_JirSyK4g/exec')

# GCP で作る「ウェブアプリケーション」の OAuth クライアントID。
# 秘密ではない（ページに書いてよい）。承認済みの JavaScript 生成元に
# https://tokiwa1928.github.io を入れておくこと。
CLIENT_ID = '301364298857-pmt4p3fq440fh6hct3m8avcnlf11jos7.apps.googleusercontent.com'


# ---------------------------------------------------------------- 見た目

STYLE = r"""
<style>
  #fmbar{ position:sticky; top:0; z-index:60; display:flex; gap:7px; align-items:center;
          flex-wrap:wrap; padding:6px 12px; background:#1a1a1a; color:#fff;
          font-size:13px; border-bottom:2px solid #000; }
  #fmbar input,#fmbar select{ font:inherit; padding:4px 7px; border:1px solid #555;
          border-radius:4px; background:#fff; color:#1a1a1a; }
  #fmbar input{ width:150px; }
  #fmbar button{ font:inherit; padding:5px 12px; border-radius:5px; cursor:pointer;
                 border:1px solid #555; background:#333; color:#fff; }
  #fmbar button.go{ background:#fff; color:#1a1a1a; font-weight:700; border-color:#fff; }
  #fmbar button.save{ background:#1d6f3f; border-color:#1d6f3f; font-weight:700; }
  #fmbar button.new{ background:#334155; border-color:#475569; }
  #fmbar button:disabled{ opacity:.4; cursor:default; }
  #fmbar a.back{ color:#cbd5e1; text-decoration:none; font-size:12px; }
  #fmbar a.back:hover{ color:#fff; text-decoration:underline; }
  #fmbar .sep{ width:1px; height:20px; background:#555; margin:0 3px; }
  #fmstage{ font-weight:700; padding:2px 9px; border-radius:11px; background:#475569; }
  #fmstage.yosan{ background:#7c5a18; }
  #fmstage.mitsu{ background:#1e4d8c; }
  #fmstage.juchu{ background:#1d6f3f; }
  #fmstage.shitchu{ background:#6b2320; }
  #fmstat{ margin-left:auto; font-size:12px; color:#cbd5e1; text-align:right; max-width:38%; }
  #fmstat.err{ color:#ffb4ac; font-weight:700; }
  #fmstat.ok{ color:#9ae6b4; }
  #fmwho{ font-size:11.5px; color:#94a3b8; }
  #fmsignin{ display:none; }
  #fmdiff{ display:none; background:#fff7ed; border-bottom:2px solid #b45309; padding:9px 14px; }
  #fmdiff h4{ margin:0 0 6px; font-size:13.5px; color:#7c2d12; }
  #fmdiff table{ border-collapse:collapse; font-size:12px; }
  #fmdiff td{ border:1px solid #e7d3ba; padding:2px 8px; }
  #fmdiff td.k{ background:#fffaf3; font-weight:700; }
  #fmdiff td.b{ color:#7c2d12; font-weight:700; }
  #fmdiff tr.money td{ background:#fee2e2; }
  #fmdiff .close{ float:right; cursor:pointer; border:1px solid #b45309; background:#fff;
                  color:#7c2d12; border-radius:4px; padding:2px 9px; font-size:11.5px; }
  #fmerr{ display:none; background:#7a2018; color:#fff; padding:6px 12px; font-size:12.5px; }
  #fmfind{ display:block; background:#f1f5f9; border-bottom:2px solid #64748b; padding:8px 14px; }
  #fmfind .cond{ display:flex; gap:8px; align-items:flex-end; flex-wrap:wrap; }
  #fmfind label{ font-size:11px; color:#475569; display:block; margin-bottom:2px; }
  #fmfind input,#fmfind select{ font:inherit; font-size:13px; padding:4px 7px;
        border:1px solid #94a3b8; border-radius:4px; background:#fff; color:#1a1a1a; }
  #fmfind button{ font:inherit; font-size:13px; padding:5px 14px; border-radius:5px; cursor:pointer;
        border:1px solid #334155; background:#334155; color:#fff; font-weight:700; }
  #fmfind button.plain{ background:#fff; color:#334155; font-weight:400; }
  #fmfind .hit{ font-size:12px; color:#475569; margin:6px 0 3px; }
  #fmgaichu{ display:none; background:#fdf6e3; border-bottom:2px solid #b45309; padding:6px 14px; font-size:12px; }
  #fmgaichu table{ border-collapse:collapse; }
  #fmgaichu th{ background:#fde68a; padding:3px 8px; font-weight:600; text-align:left; }
  #fmgaichu td{ padding:2px 6px; border-bottom:1px solid #f3e8c8; }
  #fmgaichu input{ font-size:12px; padding:2px 4px; border:1px solid #cbd5e1; border-radius:3px; }
  #fmgaichu input.n{ width:70px; text-align:right; }
  #fmgaichu .tot{ font-weight:700; }
  #fmgaichu button{ font-size:12px; padding:3px 10px; }
  #fmfind .rows{ max-height:44vh; overflow:auto; background:#fff; border:1px solid #cbd5e1; border-radius:5px; }
  #fmfind table{ border-collapse:collapse; width:100%; font-size:12px; }
  #fmfind th{ position:sticky; top:0; background:#e2e8f0; text-align:left; padding:4px 7px;
        border-bottom:1px solid #cbd5e1; white-space:nowrap; font-weight:700; }
  #fmfind td{ padding:3px 7px; border-bottom:1px solid #eef2f7; white-space:nowrap; }
  #fmfind tr.r:hover td{ background:#fef9c3; cursor:pointer; }
  #fmfind td.num{ text-align:right; }
  #fmfind .badge{ font-size:10.5px; font-weight:700; padding:1px 6px; border-radius:9px; color:#fff; background:#475569; }
  #fmfind .badge.yosan{ background:#7c5a18; }
  #fmfind .badge.mitsu{ background:#1e4d8c; }
  #fmfind .badge.juchu{ background:#1d6f3f; }
  #fmfind .badge.shitchu{ background:#6b2320; }
  .fm-dirty{ outline:2px solid #d97706 !important; outline-offset:-2px; }
</style>
"""

BAR = r"""
<div id="fmbar">
  __BACK__
  <b>FileMaker</b>
  <input id="fm-no" placeholder="伝票番号・見積番号" autocomplete="off">
  <button class="go" id="fm-load">読み込む</button>
  <button id="fm-find">探す</button>
  <span class="sep"></span>
  <span id="fmstage">—</span>
  <select id="fm-hist" title="この案件の段階"><option>—</option></select>
  <span class="sep"></span>
  <span style="font-size:12px;color:#cbd5e1">新しく起こす</span>
  <button class="new" data-kind="予算見積">予算見積</button>
  <button class="new" data-kind="見積">見積</button>
  <button class="new" data-kind="受注">受注</button>
  <span class="sep"></span>
  <button class="save" id="fm-save" disabled>保存</button>
  <button id="fm-reload" disabled title="編集を捨てて FileMaker の内容に戻す">読み直す</button>
  <span id="fmwho"></span>
  <span id="fmsignin"></span>
  <span id="fmstat">番号を入れて「読み込む」／何も読み込まずに「新しく起こす」と新規案件</span>
</div>
<div id="fmdiff"></div>
<div id="fmerr"></div>
<div id="fmfind">
  <div class="cond">
    <div><label>品名で探す</label><input id="ff-kw" placeholder="打つと出ます。a10000 なら伝票番号の前方一致" autocomplete="off"></div>
    <div><label>得意先コード</label><input id="ff-cust" style="width:110px" autocomplete="off"></div>
    <div><label>段階</label>
      <select id="ff-stage">
        <option value="">すべて</option>
        <option>予算見積</option><option>見積</option><option>受注</option><option>失注</option>
      </select></div>
    <div><label>期間（起票日）</label>
      <select id="ff-days">
        <option value="90">直近3か月</option>
        <option value="365">直近1年</option>
        <option value="1095">直近3年</option>
        <option value="0">すべて（遅い）</option>
      </select></div>
    <div><label>件数</label>
      <select id="ff-n"><option>50</option><option>100</option><option>200</option></select></div>
    <button id="ff-go">探す</button>
    <button class="plain" id="ff-x">閉じる</button>
    <span class="hit" id="ff-msg" style="margin-left:auto"></span>
  </div>
  <div class="rows" id="ff-rows" style="display:none"></div>
</div>
<div id="fmgaichu">
  <div style="display:flex;gap:10px;align-items:center;margin-bottom:4px">
    <b>外注（FileMaker 外注データ）</b>
    <span id="gc-msg" style="color:#92400e"></span>
    <button id="gc-add" class="plain" style="margin-left:auto">＋ 行を足す</button>
    <button id="gc-save">外注を保存</button>
  </div>
  <table><thead><tr><th>#</th><th>外注コード</th><th>会社名</th><th>発注内容</th><th>数量</th><th>単価</th><th>合計</th></tr></thead>
  <tbody id="gc-rows"></tbody>
  <tfoot><tr><td colspan="6" style="text-align:right">外注合計</td><td class="tot" id="gc-total" style="text-align:right"></td></tr></tfoot></table>
  <div style="color:#92400e;margin-top:3px">合計は FileMaker の計算（数量×単価）。保存すると原価（合計金額）に反映されます。Repeat 登録でも一緒に写ります</div>
</div>
"""


# ------------------------------------------- 中継の呼び方（ここだけが違う）

呼ぶ_GAS = r"""
<script>
// Apps Script が配る版。ページ自体が社内アカウントでしか開けないので、
// 誰が呼んだかは Session.getActiveUser() で分かる。
window.FM呼ぶ = function (name, args) {
  return new Promise(function (done, fail) {
    google.script.run
      .withSuccessHandler(function (r) {
        if (r && r.ok === false) fail(new Error(r.error || '不明なエラー')); else done(r);
      })
      .withFailureHandler(function (e) { fail(e); })
      [name].apply(null, args || []);
  });
};
window.FM見た目 = function () {};
</script>
"""

呼ぶ_HUB = r"""
<script src="https://accounts.google.com/gsi/client" async defer></script>
<script>
// Hub（GitHub Pages）に置く版。ページは誰でも開けるので、
// Google のサインインで受け取った ID トークンを毎回そえて中継に送る。
// 中継はそれを Google に確かめ、社内のドメインでなければ何もしない。
(function () {
  'use strict';

  var 中継 = '__WEBAPP__';
  var クライアントID = '__CLIENT_ID__';

  // 位置で渡していた引数を、fetch 用に名前つきに直す
  var 引数名 = {
    '画面_読み込み':       ['番号'],
    '画面_recordIdで読む': ['recordId'],
    '画面_保存':           ['recordId', 'modId', 'fields', '元', '強制'],
    '写し_差分':           ['日付'],
    '画面_新規案件':       ['種別', '初期値'],
    '画面_新規段階':       ['案件ID', '種別'],
    '画面_Repeat登録':     ['recordId'],
    '画面_削除':           ['recordId', 'modId'],
    '画面_外注':           ['伝票番号'],
    '画面_外注保存':       ['recordId', 'modId', '行'],
    '画面_外注作成':       ['伝票番号', '行'],
    '画面_全項目':         ['recordId'],
    '用紙注文_一覧':       ['件数'],
    '用紙注文_読む':       ['発注番号'],
    '用紙注文_作る':       ['fields'],
    '用紙注文_保存':       ['recordId', 'modId', 'fields'],
    '用紙注文_削除':       ['recordId'],
    'マスタ_配る':         ['layout'],
    'マスタ_写す':         ['layout'],
    '画面_一覧':           ['条件'],
    '写し_索引を配る':     []
  };

  var トークン = '', 期限 = 0, 待っている = null;

  function 中身を読む(jwt) {
    try {
      var p = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      return { exp: (p.exp || 0) * 1000, email: p.email || '' };
    } catch (e) { return { exp: 0, email: '' }; }
  }

  var 置き場 = 'fm_id_token';

  function 名乗る(jwt) {
    トークン = jwt;
    var p = 中身を読む(jwt);
    期限 = p.exp;
    // 読み直すたびにサインインし直さずに済むよう、このブラウザの中に覚えておく（タブをまたいで使える）。
    // トークン自体が1時間で切れる。
    try { localStorage.setItem(置き場, jwt); } catch (e) {}
    var who = document.getElementById('fmwho');
    if (who) who.textContent = p.email ? '　' + p.email : '';
    var box = document.getElementById('fmsignin');
    if (box) box.style.display = 'none';
    if (待っている) { var f = 待っている; 待っている = null; f(); }
  }

  function GISを待つ() {
    return new Promise(function (done, fail) {
      var 残り = 100;
      var t = setInterval(function () {
        if (window.google && google.accounts && google.accounts.id) { clearInterval(t); done(); }
        else if (--残り <= 0) { clearInterval(t); fail(new Error('Google のサインインを読み込めませんでした')); }
      }, 100);
    });
  }

  var 用意 = null;
  function 用意する() {
    if (用意) return 用意;
    用意 = GISを待つ().then(function () {
      google.accounts.id.initialize({
        client_id: クライアントID,
        auto_select: true,
        callback: function (res) { if (res && res.credential) 名乗る(res.credential); }
      });
      var box = document.getElementById('fmsignin');
      if (box) {
        // CSS で display:none にしてあるので、'' ではなく実際の値を入れる
        box.style.display = 'inline-block';
        google.accounts.id.renderButton(box, { type: 'standard', size: 'small', text: 'signin' });
      }
      google.accounts.id.prompt();
    });
    return 用意;
  }

  function 覚えているものを使う() {
    if (トークン) return;
    var jwt = '';
    try { jwt = localStorage.getItem(置き場) || ''; } catch (e) {}
    if (!jwt) return;
    if (中身を読む(jwt).exp - Date.now() > 5 * 60 * 1000) 名乗る(jwt);
    else { try { localStorage.removeItem(置き場); } catch (e) {} }
  }

  function 忘れる() {
    トークン = ''; 期限 = 0;
    try { localStorage.removeItem(置き場); } catch (e) {}
    var who = document.getElementById('fmwho'); if (who) who.textContent = '';
    var box = document.getElementById('fmsignin'); if (box) box.style.display = 'inline-block';
  }

  function トークンを得る() {
    覚えているものを使う();
    if (トークン && 期限 - Date.now() > 5 * 60 * 1000) return Promise.resolve(トークン);
    トークン = '';
    if (!クライアントID) {
      return Promise.reject(new Error(
        'サインインの設定がまだです（OAuth クライアントIDが未設定）。'
        + 'tools/fm-relay/設置手順.md をご覧ください'));
    }
    return 用意する().then(function () {
      if (トークン) return トークン;
      return new Promise(function (done, fail) {
        var 時間切れ = setTimeout(function () {
          待っている = null;
          var box = document.getElementById('fmsignin');
          if (box) box.style.display = 'inline-block';
          fail(new Error('サインインしてください。黒帯の「ログイン」を押して、'
                         + '社内のアカウントを選んでください（この画面が裏にあると出せません）'));
        }, 20000);
        待っている = function () { clearTimeout(時間切れ); done(トークン); };
        try { google.accounts.id.prompt(); } catch (e) {}
      });
    });
  }

  // サインイン済みなら誰か（メール）。まだなら ''。自動で索引を取るかどうかの判断に使う
  window.FM名乗っている = function () {
    覚えているものを使う();
    return (トークン && 期限 - Date.now() > 60 * 1000) ? 中身を読む(トークン).email : '';
  };

  window.FM呼ぶ = function (name, args) {
    var 名 = 引数名[name];
    if (!名) return Promise.reject(new Error('知らない操作です: ' + name));
    return トークンを得る().then(function (jwt) {
      var body = { action: name, idToken: jwt };
      名.forEach(function (k, i) { body[k] = (args || [])[i]; });
      return fetch(中継, {
        method: 'POST',
        // text/plain にしておくと事前確認（preflight）が飛ばない。
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
  };

  // 開いた時点でサインインを始めておく（押してから待たせないため）
  window.FM見た目 = function () {
    覚えているものを使う();
    if (!クライアントID) {
      var s = document.getElementById('fmstat');
      if (s) {
        s.className = 'err';
        s.textContent = 'サインインの設定がまだです（設置手順.md の「Hub から呼ぶ準備」）';
      }
      return;
    }
    用意する().catch(function () {});
  };
})();
</script>
"""


# ------------------------------------------------ 画面の中身（共通・長い）

LOGIC = r"""
<script>
(function () {
  'use strict';

  var 呼ぶ = window.FM呼ぶ;

  // 画面の項目id → FileMaker の列名（FMUSE から。列が無いものは除く）
  var TO_FM = {}, FROM_FM = {};
  Object.keys(FMUSE).forEach(function (id) {
    var col = FMUSE[id].c;
    if (!col || col.indexOf('FM') === 0) return;
    TO_FM[id] = col;
    (FROM_FM[col] = FROM_FM[col] || []).push(id);
  });
  var MONEY = ['合計金額','売価金額','用紙代','印刷代','版代','加工賃','梱包代','配送代','人件費',
               '用紙代1','用紙代2','用紙代3','印刷代1','印刷代2','印刷代3','売価単価'];
  var STAGE_CLASS = { '予算見積':'yosan', '見積':'mitsu', '受注':'juchu', '失注':'shitchu' };

  var 現在 = null, 読込時 = {}, 書ける = null;

  function $(id) { return document.getElementById(id); }
  var bar = $('fmbar'), 番号欄 = $('fm-no'), stat = $('fmstat'), 段階札 = $('fmstage');
  var 履歴欄 = $('fm-hist'), diff = $('fmdiff'), err = $('fmerr'), 探し = $('fmfind');
  var btnL = $('fm-load'), btnS = $('fm-save'), btnR = $('fm-reload'), btnF = $('fm-find');

  function 状態(m, k) { stat.textContent = m; stat.className = k || ''; }
  function 失敗(m) { err.textContent = m || ''; err.style.display = m ? 'block' : 'none'; }
  function 待機(on) {
    btnL.disabled = on;
    btnS.disabled = on || !現在;
    btnR.disabled = on || !現在;
    Array.prototype.forEach.call(document.querySelectorAll('#fmbar button.new'),
      function (b) { b.disabled = on; });
  }

  // -------------------------------------------------- 画面に流し込む

  // FileMaker の日付は MM/DD/YYYY。<input type="date"> は YYYY-MM-DD しか受け付けず、
  // 合わない値を入れると空になる。それを「変更あり」と誤解して空で保存すると
  // 起票日が消える。ここで両方向に直す。
  var 日付型 = /^(\d{2})\/(\d{2})\/(\d{4})$/;
  var 画面型 = /^(\d{4})-(\d{2})-(\d{2})$/;
  function 画面の日付へ(v) {
    var m = 日付型.exec(String(v || '').trim());
    return m ? (m[3] + '-' + m[1] + '-' + m[2]) : String(v || '');
  }
  function FMの日付へ(v) {
    var m = 画面型.exec(String(v || '').trim());
    return m ? (m[2] + '/' + m[3] + '/' + m[1]) : String(v || '');
  }
  function 日付欄か(el) { return el && el.tagName === 'INPUT' && el.type === 'date'; }

  function 流し込む(rec) {
    現在 = rec; 読込時 = {};
    Object.keys(TO_FM).forEach(function (id) {
      var el = document.getElementById(id); if (!el) return;
      var v = rec.fields[TO_FM[id]];
      v = (v === undefined || v === null) ? '' : String(v);
      if (日付欄か(el)) v = 画面の日付へ(v);
      s(id, v); 読込時[id] = v; el.classList.remove('fm-dirty');
    });
    var 区分 = rec.fields['案件区分'] || '受注';
    段階札.textContent = 区分 + '  ' + (rec.fields['見積番号'] || rec.fields['伝票番号'] || '');
    段階札.className = STAGE_CLASS[区分] || '';
    try { calc(); } catch (e) {}
    try { onInk(); } catch (e) {}
    try { applyRowVis(); } catch (e) {}
    try { refreshNote(); } catch (e) {}
  }

  function 履歴を出す(list) {
    履歴欄.innerHTML = '';
    if (!list || !list.length) { 履歴欄.innerHTML = '<option>—</option>'; return; }
    list.forEach(function (h) {
      var o = document.createElement('option');
      o.value = h.recordId;
      o.textContent = h.区分 + '  ' + h.番号 + '  ' + (h.起票日 || '')
                    + (h.合計金額 ? '  ¥' + Number(h.合計金額).toLocaleString() : '');
      if (現在 && String(h.recordId) === String(現在.recordId)) o.selected = true;
      履歴欄.appendChild(o);
    });
  }

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function 差分を出す(参考, 差) {
    diff.style.display = 'none';
    if (!参考 || !差 || !差.length) return;
    var 見せる = 差.filter(function (d) {
      return FROM_FM[d.項目] || MONEY.indexOf(d.項目) >= 0;
    });
    if (!見せる.length) return;
    見せる.sort(function (a, b) {
      return (MONEY.indexOf(a.項目) >= 0 ? 0 : 1) - (MONEY.indexOf(b.項目) >= 0 ? 0 : 1);
    });
    var 上限 = 40, 出す = 見せる.slice(0, 上限), h = '';
    h += '<button class="close" id="fmdiff-x">閉じる</button>';
    h += '<h4>⚠ ' + esc(参考.番号) + '（' + esc(参考.起票日) + '）とは内容が変わっています</h4>';
    h += '<table>';
    出す.forEach(function (d) {
      var money = MONEY.indexOf(d.項目) >= 0;
      h += '<tr class="' + (money ? 'money' : '') + '">'
         + '<td class="k">' + esc(d.項目) + '</td>'
         + '<td>' + (esc(d.前) || '空') + '</td>'
         + '<td class="b">→ ' + (esc(d.後) || '空') + '</td></tr>';
    });
    h += '</table>';
    if (見せる.length > 上限) {
      h += '<div style="font-size:11.5px;color:#7c2d12;margin-top:4px">ほか '
         + (見せる.length - 上限) + ' 項目</div>';
    }
    h += '<div style="font-size:11.5px;color:#7c2d12;margin-top:5px">'
       + '前回の金額をそのまま使わないでください。仕様が変わっています。</div>';
    diff.innerHTML = h;
    diff.style.display = 'block';
    $('fmdiff-x').onclick = function () { diff.style.display = 'none'; };
  }

  // -------------------------------------------------- 読み込み

  function 受け取る(r, msg, ms) {
    書ける = r.writable || 書ける;
    if (!r.record) { 現在 = null; 状態('見つかりません', 'err'); 待機(false); return; }
    流し込む(r.record);
    履歴を出す(r['履歴']);
    番号欄.value = r.record.fields['見積番号'] || r.record.fields['伝票番号'] || '';
    差分を出す(r['参考'], r['差分']);
    状態(msg + (ms ? '（' + ms + 'ms）' : ''), 'ok');
    待機(false);
    外注を読む(r.record.fields['伝票番号']);
  }

  // -------------------------------------------------- 外注（FileMaker 外注データ・別テーブル）
  var 外注 = null;   // { recordId, modId, 行:[…] } または null（無ければ新規）
  function 外注を読む(伝票番号) {
    var box = $('fmgaichu'); if (!伝票番号) { box.style.display = 'none'; return; }
    外注 = null; $('gc-rows').innerHTML = ''; $('gc-total').textContent = ''; $('gc-msg').textContent = '読んでいます…'; box.style.display = 'block';
    呼ぶ('画面_外注', [伝票番号]).then(function (r) {
      外注 = (r.外注 && r.外注[0]) || null;
      外注を描く(外注 ? 外注.行 : []);
      $('gc-msg').textContent = 外注 ? '' : '外注はありません（＋ 行を足す で登録）';
    }).catch(function (e) { $('gc-msg').textContent = String(e.message || e); });
  }
  function 外注を描く(行) {
    var h = '';
    for (var i = 1; i <= 4; i++) {
      var x = 行.filter(function (y) { return Number(y.番) === i; })[0];
      if (!x && i > Math.max(1, 行.length)) continue;
      x = x || {};
      h += '<tr data-i="' + i + '"><td>' + i + '</td>'
        + '<td><input class="gc-code" style="width:60px" value="' + esc(x.外注コード || '') + '"></td>'
        + '<td><input class="gc-name" style="width:180px" value="' + esc(x.会社名 || '') + '"></td>'
        + '<td><input class="gc-what" style="width:220px" value="' + esc(x.発注内容 || '') + '"></td>'
        + '<td><input class="gc-qty n" value="' + esc(x.数量 == null ? '' : x.数量) + '"></td>'
        + '<td><input class="gc-price n" value="' + esc(x.単価 == null ? '' : x.単価) + '"></td>'
        + '<td class="gc-sum" style="text-align:right">' + esc(円(x.合計)) + '</td></tr>';
    }
    $('gc-rows').innerHTML = h;
    外注合計を出す();
    Array.prototype.forEach.call($('gc-rows').querySelectorAll('input.n'), function (el) { el.addEventListener('input', 外注合計を出す); });
  }
  function 外注合計を出す() {
    var 総 = 0;
    Array.prototype.forEach.call($('gc-rows').querySelectorAll('tr'), function (tr) {
      var q = Number(tr.querySelector('.gc-qty').value || 0), p = Number(tr.querySelector('.gc-price').value || 0);
      var s = q * p; tr.querySelector('.gc-sum').textContent = (q || p) ? s.toLocaleString() : ''; 総 += s;   // FileMaker と同じく丸めない
    });
    $('gc-total').textContent = 総.toLocaleString();
  }
  function 外注の行() {
    var out = [];
    Array.prototype.forEach.call($('gc-rows').querySelectorAll('tr'), function (tr) {
      var o = { 番: Number(tr.getAttribute('data-i')), 外注コード: tr.querySelector('.gc-code').value.trim(), 会社名: tr.querySelector('.gc-name').value.trim(),
                発注内容: tr.querySelector('.gc-what').value.trim(), 数量: tr.querySelector('.gc-qty').value.trim(), 単価: tr.querySelector('.gc-price').value.trim() };
      if (o.外注コード || o.会社名 || o.数量) out.push(o);
    });
    return out;
  }
  $('gc-add').onclick = function () {
    var n = $('gc-rows').querySelectorAll('tr').length; if (n >= 4) { alert('外注は 4 件までです（FileMaker と同じ）'); return; }
    var 行 = 外注の行(); 行.push({ 番: n + 1 }); 外注を描く(行);
  };
  $('gc-save').onclick = function () {
    if (!現在) return;
    var 行 = 外注の行();
    if (!外注) {
      if (!行.length) { $('gc-msg').textContent = '行がありません'; return; }
      $('gc-msg').textContent = '作っています…';
      呼ぶ('画面_外注作成', [String(現在.fields['伝票番号'] || ''), 行]).then(function (r) {
        外注 = (r.外注 && r.外注[0]) || null; 外注を描く(外注 ? 外注.行 : []); $('gc-msg').textContent = '登録しました';
        読み込む(String(現在.fields['伝票番号'] || ''));
      }).catch(function (e) { $('gc-msg').textContent = String(e.message || e); });
      return;
    }
    $('gc-msg').textContent = '保存しています…';
    呼ぶ('画面_外注保存', [外注.recordId, 外注.modId, 行]).then(function (r) {
      外注 = (r.外注 && r.外注[0]) || null; 外注を描く(外注 ? 外注.行 : []);
      $('gc-msg').textContent = r.変更なし ? '変わっていません' : '保存しました';
      // 原価（合計金額）が変わるので伝票を読み直す
      if (!r.変更なし) 読み込む(String(現在.fields['伝票番号'] || ''));
    }).catch(function (e) { $('gc-msg').textContent = String(e.message || e); });
  };

  function 読み込む(番号) {
    番号 = (番号 || 番号欄.value || '').trim();
    if (!番号) { 状態('番号を入れてください', 'err'); return; }
    待機(true); 失敗(''); diff.style.display = 'none'; 状態('読み込み中… ' + 番号);
    var t0 = Date.now();
    呼ぶ('画面_読み込み', [番号])
      .then(function (r) { 受け取る(r, 番号 + ' を読み込みました', Date.now() - t0); })
      .catch(function (e) { 現在 = null; 状態(String(e.message || e), 'err'); 待機(false); });
  }

  履歴欄.onchange = function () {
    var id = 履歴欄.value;
    if (!id || id === '—') return;
    if (Object.keys(変更分()).length && !confirm('編集を捨てて切り替えますか？')) return;
    待機(true); 状態('切り替え中…');
    呼ぶ('画面_recordIdで読む', [id])
      .then(function (r) { 受け取る(r, '切り替えました'); })
      .catch(function (e) { 状態(String(e.message || e), 'err'); 待機(false); });
  };

  // -------------------------------------------------- 新しく起こす

  Array.prototype.forEach.call(document.querySelectorAll('#fmbar button.new'), function (b) {
    b.onclick = function () {
      var 種別 = b.getAttribute('data-kind');
      var 案件ID = 現在 && 現在.fields['案件ID'];
      if (Object.keys(変更分()).length
          && !confirm('保存していない編集があります。捨てて新しく起こしますか？')) return;

      var 文 = 案件ID
        ? ('案件 ' + 案件ID + ' の ' + 種別 + ' を起こします。\n\n'
           + '内容はこの案件のいちばん新しい段階から引き継ぎます。\n'
           + '前回の ' + 種別 + ' があれば、変わったところを表示します。')
        : ('まっさらな案件として ' + 種別 + ' を起こします。\n\n'
           + '既にある案件の続きにしたいときは、先にその番号を読み込んでください。');
      if (!confirm(文)) return;

      待機(true); 失敗(''); diff.style.display = 'none';
      状態((案件ID ? '起こしています… ' : '新規案件を起こしています… ') + 種別);
      var t0 = Date.now();
      var p = 案件ID ? 呼ぶ('画面_新規段階', [案件ID, 種別])
                     : 呼ぶ('画面_新規案件', [種別, {}]);
      p.then(function (r) {
        var no = r.record.fields['見積番号'] || r.record.fields['伝票番号'] || '';
        受け取る(r, 種別 + ' を起こしました  ' + no, Date.now() - t0);
      }).catch(function (e) { 状態(String(e.message || e), 'err'); 待機(false); });
    };
  });

  // -------------------------------------------------- 保存

  function 変更分() {
    var out = {};
    if (!現在) return out;
    Object.keys(TO_FM).forEach(function (id) {
      var el = document.getElementById(id); if (!el) return;
      var now = String(el.value == null ? '' : el.value).trim();
      if (now === (読込時[id] || '')) return;
      var col = TO_FM[id];
      if (書ける && 書ける.indexOf(col) < 0) return;
      out[col] = 日付欄か(el) ? FMの日付へ(now) : now;
    });
    return out;
  }

  // 読み込んだときは入っていたのに、いま空になっている項目（消す操作）
  function 空にする項目(差) {
    var 消す = [];
    Object.keys(TO_FM).forEach(function (id) {
      var col = TO_FM[id];
      if (差[col] === '' && (読込時[id] || '') !== '') 消す.push(col);
    });
    return 消す;
  }

  function 保存() {
    if (!現在) return;
    var 差 = 変更分(), n = Object.keys(差).length;
    if (!n) { 状態('変更はありません', ''); return; }
    var 消す = 空にする項目(差);
    var 文 = n + ' 項目を FileMaker に保存します。よろしいですか？\n\n'
          + Object.keys(差).slice(0, 30).join('、')
          + (n > 30 ? ' …ほか' + (n - 30) + '件' : '');
    if (消す.length) {
      文 += '\n\n⚠ 次の項目は【空】になります: ' + 消す.join('、');
    }
    if (!confirm(文)) return;
    // 読み込んだときの値（同じ項目を相手も直したかを中継が見る）
    var 元 = {};
    Object.keys(TO_FM).forEach(function (id) { var col = TO_FM[id]; if (col in 差) { var el = document.getElementById(id); 元[col] = 日付欄か(el) ? FMの日付へ(読込時[id] || '') : (読込時[id] || ''); } });
    保存を送る(差, 元, false);
  }
  function 保存を送る(差, 元, 強制) {
    var n = Object.keys(差).length;
    待機(true); 失敗(''); 状態('保存中… ' + n + ' 項目');
    呼ぶ('画面_保存', [現在.recordId, 現在.modId, 差, 元, 強制]).then(function (r) {
      if (r.conflict) {
        // 同じ項目を相手も直している。相手の値で読み直すか、自分の値で上書きするか
        var 行 = Object.keys(r.衝突 || {}).map(function (k) { return k + '　相手: ' + (r.衝突[k].相手 == null ? '' : r.衝突[k].相手) + '　／　あなた: ' + (r.衝突[k].あなた == null ? '' : r.衝突[k].あなた); });
        待機(false); 状態('同じ項目を別の人も直しています', 'err');
        if (confirm('別の人が同じ項目を先に直しています。\n\n' + 行.join('\n') + '\n\n[OK] 自分の値で上書きする　／　[キャンセル] 相手の値で読み直す（自分の編集は捨てます）')) {
          現在.modId = r.modId;   // 最新の上に重ねる
          保存を送る(差, 元, true);
        } else {
          流し込む({ recordId: r.recordId, modId: r.modId, fields: r.fields });
          状態('相手の値で読み直しました', 'ok');
        }
        return;
      }
      流し込む({ recordId: r.recordId, modId: r.modId, fields: r.fields });
      状態(r.saved.length + ' 項目を保存しました（金額は再計算済み）' + (r.合流 ? '　※別の人の変更の上に重ねました' : ''), 'ok');
      待機(false);
    }).catch(function (e) { 状態(String(e.message || e), 'err'); 待機(false); });
  }

  // -------------------------------------------------- 探す

  var 列 = [
    { c:'伝票番号',   h:'伝票番号' },
    { c:'見積番号',   h:'見積番号' },
    { c:'案件区分',   h:'段階', badge:true },
    { c:'起票日',     h:'起票日', date:true },
    { c:'得意先コード', h:'得意先' },
    { c:'製品名',     h:'製品名' },
    { c:'品種',       h:'品種' },
    { c:'合計数1',    h:'数量', num:true },
    { c:'売価金額',   h:'売価', money:true },
    { c:'合計金額',   h:'原価', money:true },
    { c:'納品日',     h:'納品日', date:true },
    { c:'注残数',     h:'注残', num:true }
  ];

  // FileMaker は MM/DD/YYYY で返す。日本の並びに直す
  function 日付(v) {
    var m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(v || ''));
    return m ? (m[3] + '/' + m[1] + '/' + m[2]) : (v == null ? '' : v);
  }

  function 円(v) {
    var x = Number(v);
    return (v === '' || v === undefined || v === null || isNaN(x)) ? '' : x.toLocaleString();
  }

  function 一覧を出す(r) {
    var box = $('ff-rows');
    if (!r.行 || !r.行.length) {
      box.style.display = 'none';
      $('ff-msg').textContent = '見つかりませんでした';
      return;
    }
    var h = '<table><thead><tr>';
    列.forEach(function (k) { h += '<th>' + esc(k.h) + '</th>'; });
    h += '</tr></thead><tbody>';
    r.行.forEach(function (row) {
      h += '<tr class="r" data-id="' + esc(row.recordId) + '">';
      列.forEach(function (k) {
        var v = row[k.c];
        if (k.badge) {
          var cls = STAGE_CLASS[v] || '';
          h += '<td>' + (v ? '<span class="badge ' + cls + '">' + esc(v) + '</span>' : '') + '</td>';
        } else if (k.date) {
          h += '<td>' + esc(日付(v)) + '</td>';
        } else if (k.money || k.num) {
          h += '<td class="num">' + esc(円(v)) + '</td>';
        } else {
          h += '<td>' + esc(v == null ? '' : v) + '</td>';
        }
      });
      h += '</tr>';
    });
    h += '</tbody></table>';
    box.innerHTML = h;
    box.style.display = 'block';
    $('ff-msg').textContent = r.件数 + ' 件'
      + (r.全体 && r.全体 > r.件数 ? '（あてはまる ' + r.全体.toLocaleString() + ' 件のうち）' : '')
      + (r.日数 ? '　起票日 直近' + r.日数 + '日' : '')
      + '　' + (r.源 === '索引' ? r.ミリ秒 + 'ms（手元の索引）' : (r.ミリ秒 / 1000).toFixed(1) + '秒') + '　行をクリックで開きます';

    Array.prototype.forEach.call(box.querySelectorAll('tr.r'), function (tr) {
      tr.onclick = function () {
        if (Object.keys(変更分()).length
            && !confirm('保存していない編集があります。捨てて開きますか？')) return;
        待機(true); 状態('開いています…');
        呼ぶ('画面_recordIdで読む', [tr.getAttribute('data-id')])
          .then(function (x) { 受け取る(x, '開きました'); })
          .catch(function (e) { 状態(String(e.message || e), 'err'); 待機(false); });
      };
    });
  }

  // ---- 手元の索引（写しの 受注_索引 を一度もらって IndexedDB に置く。打っている最中に出せる速さ）
  var 索引 = null;            // { 列:[…], 行:[[…]], 作った }
  var 索引位置 = {};          // 列名 → 添字
  var 索引日 = null;          // 行ごとの起票日 yyyymmdd（期間で絞る用）
  function 索引を開くDB() {
    return new Promise(function (res, rej) {
      if (!window.indexedDB) return rej(new Error('IndexedDB なし'));
      var q = indexedDB.open('tokiwa_fm_index', 1);
      q.onupgradeneeded = function () { q.result.createObjectStore('idx'); };
      q.onsuccess = function () { res(q.result); }; q.onerror = function () { rej(q.error); };
    });
  }
  function 索引を据える(j) {
    索引 = j; 索引位置 = {}; j.列.forEach(function (c, i) { 索引位置[c] = i; });
    var d = 索引位置['起票日'];
    索引日 = j.行.map(function (r) { var m = /^(\d\d)\/(\d\d)\/(\d{4})$/.exec(String(r[d] || '')); return m ? Number(m[3] + m[1] + m[2]) : 0; });
  }
  function 索引を用意() {
    var 有効 = 24 * 60 * 60 * 1000;
    return 索引を開くDB().then(function (db) {
      return new Promise(function (res) {
        var r = db.transaction('idx').objectStore('idx').get('juchu');
        r.onsuccess = function () { res(r.result || null); }; r.onerror = function () { res(null); };
      }).then(function (o) {
        if (o && o.行) { 索引を据える(o); 索引の状態(); }
        var 古い = !o || !o.取った || (Date.now() - new Date(o.取った).getTime()) > 有効;
        if (!古い) return 索引の差分を重ねる();
        if (!(window.FM名乗っている ? FM名乗っている() : true)) return;   // サインイン前なら次の機会に
        $('ff-msg').textContent = (索引 ? '索引を取り直しています…' : '索引を取っています（初回だけ 10〜20 秒）…');
        var t0 = Date.now();
        return 呼ぶ('写し_索引を配る', []).then(function (j) {
          j.取った = new Date().toISOString();
          索引を据える(j); 索引の状態();
          console.log('[索引] ' + j.件数 + ' 件 ' + Math.round((Date.now() - t0) / 1000) + '秒');
          try { db.transaction('idx', 'readwrite').objectStore('idx').put(j, 'juchu'); } catch (e) {}
          if ($('ff-kw').value.trim()) 手元で探す();
          return 索引の差分を重ねる();
        });
      });
    }).catch(function (e) { console.warn('[索引]', e); });
  }
  function 索引の状態() {
    if (!索引) return;
    var when = 索引.作った ? new Date(索引.作った) : null;
    $('ff-msg').textContent = '索引 ' + 索引.行.length.toLocaleString() + ' 件'
      + (when ? '（' + (when.getMonth() + 1) + '/' + when.getDate() + ' ' + String(when.getHours()).padStart(2, '0') + ':' + String(when.getMinutes()).padStart(2, '0') + ' の写し）' : '')
      + '　打つと出ます';
  }
  // 手元で絞る（1 打ごと）。番号（a10000）は伝票番号の前方一致、それ以外は製品名・ユーザー名の部分一致
  var 全件モード = false;   // 「全体表示」を押したら、絞りが無くても新しい順に出す
  function 手元で探す(開いてよい) {
    if (!索引) return false;
    var kw = $('ff-kw').value.trim(), cust = $('ff-cust').value.trim(), 段階 = $('ff-stage').value;
    var 日数 = Number($('ff-days').value), 件数 = Number($('ff-n').value || 50);
    var 番号らしい = /^[a-zA-Z]?\d{2,}$/.test(kw);
    if (番号らしい) 日数 = 0;
    if (!kw && !cust && !段階 && !全件モード) { $('ff-rows').style.display = 'none'; 索引の状態(); return true; }
    全件モード = false;
    var から = 0;
    if (日数 > 0) { var d = new Date(); d.setDate(d.getDate() - 日数); から = Number(d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0')); }
    var P = 索引位置, 行 = 索引.行, kwl = kw.toLowerCase(), hits = [], t0 = Date.now();
    for (var i = 0; i < 行.length; i++) {
      var r = 行[i];
      if (から && 索引日[i] < から) continue;
      if (cust && String(r[P['得意先コード']]) !== cust) continue;
      if (段階 && String(r[P['案件区分']]) !== 段階) continue;
      if (kw) {
        if (番号らしい) { if (String(r[P['伝票番号']]).toLowerCase().indexOf(kwl) !== 0) continue; }
        else if (String(r[P['製品名']]).toLowerCase().indexOf(kwl) < 0 && String(r[P['ユーザー名']]).toLowerCase().indexOf(kwl) < 0) continue;
      }
      hits.push(i);
    }
    var 全体 = hits.length;
    if (番号らしい) hits.sort(function (a, b) { return String(行[a][P['伝票番号']]) < String(行[b][P['伝票番号']]) ? -1 : 1; });
    else hits.sort(function (a, b) { return (索引日[b] - 索引日[a]) || (Number(行[b][P['recordId']]) - Number(行[a][P['recordId']])); });
    hits = hits.slice(0, 件数);
    var out = hits.map(function (i) { var o = {}; 索引.列.forEach(function (c, ci) { o[c] = 行[i][ci]; }); o.recordId = String(o.recordId); return o; });
    一覧を出す({ 行: out, 件数: out.length, 全体: 全体, 日数: 日数, ミリ秒: Date.now() - t0, 源: '索引' });
    if (開いてよい && 番号らしい && out.length === 1) { 番号欄.value = String(out[0]['伝票番号']); 読み込む(String(out[0]['伝票番号'])); }
    return true;
  }
  // 今日の分を重ねる: 索引の写し以降に FileMaker で直った伝票を取り、手元の索引に上書き／追加
  var 差分を取った = 0;
  function 索引の差分を重ねる() {
    if (!索引 || !(window.FM名乗っている ? FM名乗っている() : true)) return Promise.resolve();
    var 基 = 索引.作った ? new Date(索引.作った) : new Date(Date.now() - 24 * 3600 * 1000);
    基 = new Date(基.getTime() - 24 * 3600 * 1000);   // 念のため 1 日戻す
    var d = ('0' + (基.getMonth() + 1)).slice(-2) + '/' + ('0' + 基.getDate()).slice(-2) + '/' + 基.getFullYear();
    return 呼ぶ('写し_差分', [d]).then(function (r) {
      if (!r.行 || !r.行.length) return;
      var P = 索引位置, id = P['recordId'], pos = {};
      for (var i = 0; i < 索引.行.length; i++) pos[String(索引.行[i][id])] = i;
      var 上書き = 0, 追加 = 0;
      r.行.forEach(function (row) {
        // 列の並びを手元の索引に合わせる
        var v = 索引.列.map(function (c) { var j = r.列.indexOf(c); return j < 0 ? '' : row[j]; });
        var at = pos[String(v[id])];
        if (at !== undefined) { 索引.行[at] = v; 上書き++; } else { 索引.行.push(v); pos[String(v[id])] = 索引.行.length - 1; 追加++; }
      });
      索引を据える(索引);   // 起票日の数を作り直す
      差分を取った = Date.now();
      索引の状態();
      $('ff-msg').textContent += '　今日の分 ' + r.件数 + ' 件を重ねました';
      if ($('ff-kw').value.trim()) 手元で探す(false);
    }).catch(function (e) { console.warn('[索引 差分]', e); });
  }
  setInterval(function () { if (索引 && Date.now() - 差分を取った > 5 * 60 * 1000) 索引の差分を重ねる(); }, 60 * 1000);

  var 打鍵タイマー = null;
  function 打ちながら() {
    clearTimeout(打鍵タイマー);
    打鍵タイマー = setTimeout(function () { 手元で探す(false); }, 120);
  }

  function 探す() {
    if (手元で探す(true)) return;   // 索引があれば手元で（速い）。無ければ中継に聞く
    // 伝票番号（a10000 のような形）を品名欄に入れたら、番号の前方一致で全期間から探す（中継が判断）
    var kw = $('ff-kw').value.trim();
    var 番号らしい = /^[a-zA-Z]\d{3,}$/.test(kw);
    if (番号らしい) $('ff-days').value = '0';
    var 条件 = {
      'キーワード': kw,
      '得意先コード': $('ff-cust').value.trim(),
      '段階': $('ff-stage').value,
      '日数': Number($('ff-days').value),
      '件数': Number($('ff-n').value || 50)
    };
    if (番号らしい) { 条件['伝票番号'] = kw; 条件['件数'] = Math.max(条件['件数'], 100); }   // 途中まで一致する番号を全部出す（a1000 なら 100 件）
    var 絞りなし = !条件['キーワード'] && !条件['得意先コード'] && !条件['段階'];
    if (絞りなし && 条件['日数'] === 0
        && !confirm('絞り込みなしで全部を並べ替えると、45秒ほどかかります。\n\n'
                    + '品名や得意先で絞るか、期間を選ぶとすぐ返ります。続けますか？')) return;
    $('ff-msg').textContent = '探しています…';
    $('ff-go').disabled = true;
    呼ぶ('画面_一覧', [条件])
      .then(function (r) {
        一覧を出す(r);
        // 番号で探して 1 件だけなら、そのまま開く
        if (番号らしい && r && r.行 && r.行.length === 1) { 番号欄.value = r.行[0]['伝票番号']; 読み込む(r.行[0]['伝票番号']); }
      })
      .catch(function (e) { $('ff-msg').textContent = String(e.message || e); })
      .then(function () { $('ff-go').disabled = false; });
  }

  btnF.onclick = function () {
    var 開く = 探し.style.display === 'none';
    探し.style.display = 開く ? 'block' : 'none';
    if (開く) { $('ff-kw').focus(); }
  };
  $('ff-go').onclick = 探す;
  $('ff-x').onclick = function () { 探し.style.display = 'none'; };
  ['ff-kw', 'ff-cust'].forEach(function (id) {
    $(id).addEventListener('keydown', function (e) { if (e.key === 'Enter') 探す(); });
    $(id).addEventListener('input', 打ちながら);
  });
  ['ff-stage', 'ff-days', 'ff-n'].forEach(function (id) { $(id).addEventListener('change', function () { 手元で探す(false); }); });
  // -------------------------------------------------- FileMaker のボタンを本物の動きに（FMHUB-9）
  function 帯のボタン(文言) {
    return Array.prototype.filter.call(document.querySelectorAll('.hdrow .fb'), function (x) { return x.textContent.trim() === 文言; })[0];
  }
  function 帯に付ける(文言, fn, title) { var x = 帯のボタン(文言); if (!x) return; x.onclick = fn; if (x.tagName === 'A') x.removeAttribute('href'); if (title) x.title = title; }
  function 読んでから(fn) { if (!現在) { alert('先に伝票を読み込んでください（探す窓で行をクリック、または番号を入れて「読み込む」）'); return; } fn(); }

  // 受注登録／見積登録（本体のメニューから ?mode=juchu / ?mode=mitsu で開く）。見積登録は「見積」で起こす
  var モード = (function () { try { return new URLSearchParams(location.search).get('mode') || ''; } catch (e) { return ''; } })();
  var 起こす種別 = モード === 'mitsu' ? '見積' : '受注';
  if (モード) {
    var 名札 = document.querySelector('.hdrow .ttl'); if (名札) 名札.textContent = (モード === 'mitsu' ? '見積登録' : '受注登録');
    document.title = (モード === 'mitsu' ? '見積登録' : '受注登録') + ' | Tokiwa Hub';
  }
  帯に付ける('新規作成', function () {
    var n = document.querySelector('#fmbar button.new[data-kind="' + 起こす種別 + '"]') || document.querySelector('#fmbar button.new');
    if (n) n.click();
  }, 'FileMaker に新しい' + 起こす種別 + 'を起こします（黒帯の「' + 起こす種別 + '」と同じ）');
  帯に付ける('検索モード', function () { 探し.style.display = 'block'; $('ff-kw').focus(); $('ff-kw').select(); }, '探す窓に移ります。打つと出ます');
  帯に付ける('全体表示', function () {
    探し.style.display = 'block';
    $('ff-kw').value = ''; $('ff-cust').value = ''; $('ff-stage').value = ''; $('ff-days').value = '0'; $('ff-n').value = '200';
    全件モード = true;
    if (!手元で探す(false)) 探す();
  }, '新しい順に 200 件を出します');
  帯に付ける('Repeat登録', function () { 読んでから(function () {
    if (Object.keys(変更分()).length && !confirm('保存していない編集があります。捨てて Repeat 登録しますか？')) return;
    var no = String(現在.fields['伝票番号'] || '');
    if (!confirm(no + ' を元に、新しい受注を起こします。\n\n前回伝票番号 = ' + no + '、起票日 = 今日。番号・納品日・注残は引き継ぎません。\nよろしいですか？')) return;
    待機(true); 失敗(''); diff.style.display = 'none'; 状態('Repeat 登録しています… 元 ' + no);
    var t0 = Date.now();
    呼ぶ('画面_Repeat登録', [現在.recordId])
      .then(function (r) { var n2 = r.record.fields['伝票番号'] || ''; 受け取る(r, 'Repeat 登録しました  ' + n2 + '（元 ' + no + '）', Date.now() - t0); })
      .catch(function (e) { 状態(String(e.message || e), 'err'); 待機(false); });
  }); }, '読み込んでいる伝票を元に、新しい受注を FileMaker に起こします');
  帯に付ける('データ削除', function () { 読んでから(function () {
    var no = String(現在.fields['伝票番号'] || '');
    var t = prompt('FileMaker からこの伝票を削除します。取り消せません。\n\n確認のため伝票番号（' + no + '）を入れてください');
    if (t === null) return;
    if (String(t).trim() !== no) { alert('番号が違うので削除しません'); return; }
    待機(true); 状態('削除しています… ' + no);
    呼ぶ('画面_削除', [現在.recordId, 現在.modId])
      .then(function () { 現在 = null; 番号欄.value = ''; if (typeof newRec === 'function') { try { newRec(); } catch (e) {} } 状態(no + ' を削除しました（記録に残しています）'); 待機(false); })
      .catch(function (e) { 状態(String(e.message || e), 'err'); 待機(false); });
  }); }, '読み込んでいる伝票を FileMaker から消します（番号を打って確認）');
  帯に付ける('注文書', function () { var no = 現在 ? String(現在.fields['伝票番号'] || '') : ''; window.open('yoshi-chumon.html' + (no ? '?juchu=' + encodeURIComponent(no) : ''), '_blank'); }, '用紙注文書（FileMaker と同じ。読み込んでいる伝票が 1 行目に入ります）');
  帯に付ける('配送カレンダー', function () { location.href = '../index.html?page=delivery'; }, 'Hub の配送/納品へ');
  帯に付ける('外注入力', function () { location.href = '../index.html?page=outsource'; }, 'Hub の外注発注へ');
  // 作業指示書（FileMaker と同じ紙を Hub で出す）: 帯の「レイアウト編集」の前に足す
  (function () {
    var lay = 帯のボタン('レイアウト編集'); if (!lay || 帯のボタン('作業指示書')) return;
    var b2 = document.createElement('button'); b2.className = 'fb or'; b2.textContent = '作業指示書'; b2.title = '読み込んでいる伝票の作業指示書（FileMaker と同じ形）を出します';
    b2.onclick = function () { 読んでから(function () { window.open('sagyo.html?no=' + encodeURIComponent(String(現在.fields['伝票番号'] || '')), '_blank'); }); };
    lay.parentNode.insertBefore(b2, lay);
  })();
  帯に付ける('受注一覧', function () { 探し.style.display = 'block'; $('ff-days').value = '0'; $('ff-n').value = '200'; 全件モード = true; if (!手元で探す(false)) 探す(); }, '探す窓に新しい順で出します');

  setTimeout(索引を用意, 1500);                       // 開いたら索引を手元に（サインイン前なら次回）
  setInterval(function () { if (!索引) 索引を用意(); }, 30000);   // サインインが後から済んだとき用

  // -------------------------------------------------- 画面まわり

  document.addEventListener('input', function (ev) {
    var el = ev.target;
    if (!el || !el.id || 読込時[el.id] === undefined) return;
    var now = String(el.value == null ? '' : el.value).trim();
    el.classList.toggle('fm-dirty', now !== (読込時[el.id] || ''));
  }, true);

  window.addEventListener('beforeunload', function (e) {
    if (現在 && Object.keys(変更分()).length) { e.preventDefault(); e.returnValue = ''; }
  });

  btnL.onclick = function () { 読み込む(); };
  btnS.onclick = 保存;
  btnR.onclick = function () {
    if (Object.keys(変更分()).length
        && !confirm('編集を捨てて FileMaker の内容に戻します。よろしいですか？')) return;
    if (!現在) return;
    呼ぶ('画面_recordIdで読む', [現在.recordId])
      .then(function (r) { 受け取る(r, '読み直しました'); })
      .catch(function (e) { 状態(String(e.message || e), 'err'); });
  };
  番号欄.addEventListener('keydown', function (e) { if (e.key === 'Enter') 読み込む(); });

  document.body.insertBefore(err, document.body.firstChild);
  document.body.insertBefore(探し, document.body.firstChild);
  document.body.insertBefore(diff, document.body.firstChild);
  document.body.insertBefore(bar, document.body.firstChild);
  番号欄.focus();

  // 番号を渡して開ける（Hub の一覧から開くときに使う）。
  // Hub 版は URL の ?no=、Apps Script 版は doGet が書き込む window.FM初期番号。
  var q = '';
  try { q = new URLSearchParams(location.search).get('no') || ''; } catch (e) {}
  if (!q && window.FM初期番号) q = String(window.FM初期番号);
  if (q) { 番号欄.value = q; 読み込む(q); }

  try { window.FM見た目(); } catch (e) {}
})();
</script>
"""

見出し = r"""
<!-- ==================================================================
     ここから下は build_juchu.py が足したぶん（__WHICH__）。
     受注入力を FileMaker の実データにつなぎ、段階（予算見積/見積/受注）を扱う。
     元の画面（tools/fm-juchu.html）はいじっていない。
     ================================================================== -->
"""


KAIZEN = r"""
<script>window.KAIZEN_KEY = 'juchu-fm';</script>
<script src="kaizen.js"></script>
"""


def 組み立てる(src, which, 呼ぶ実装, back, 追加=''):
    addon = (見出し.replace('__WHICH__', which)
             + STYLE
             + BAR.replace('__BACK__', back)
             + 呼ぶ実装
             + LOGIC
             + 追加)
    return src.replace('</body>', addon + '\n</body>', 1)


def main():
    src = open(SRC, encoding='utf-8').read()
    if '</body>' not in src:
        print('× </body> が見つかりません')
        return 1

    gas = 組み立てる(src, 'Apps Script が配る版', 呼ぶ_GAS, '')
    hub = 組み立てる(src, 'Hub に置く版',
                     呼ぶ_HUB.replace('__WEBAPP__', WEBAPP).replace('__CLIENT_ID__', CLIENT_ID),
                     '<a class="back" href="../index.html">← Hub</a>', KAIZEN)

    # GAS の HtmlService はテンプレート記法 <?= ?> を解釈してしまうので確認だけしておく
    for bad in ('<?=', '<?!'):
        if bad in gas:
            print('△ テンプレート記法 %s が含まれています。表示が崩れるかもしれません' % bad)

    for path, text, label in ((DST_GAS, gas, 'Apps Script 版'),
                              (DST_HUB, hub, 'Hub 版')):
        open(path, 'w', encoding='utf-8').write(text)
        print('%s : %s  (%.0f KB)'
              % (label, os.path.normpath(path), len(text.encode('utf-8')) / 1024))

    if not CLIENT_ID:
        print('')
        print('△ Hub 版は OAuth クライアントIDが未設定です。')
        print('  設置手順.md の「Hub から呼ぶ準備」を済ませ、')
        print('  この build_juchu.py の CLIENT_ID に入れて流し直してください。')
    print('  元: %s' % os.path.normpath(SRC))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
