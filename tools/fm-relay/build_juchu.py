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
  #fmfind{ display:none; background:#f1f5f9; border-bottom:2px solid #64748b; padding:8px 14px; }
  #fmfind .cond{ display:flex; gap:8px; align-items:flex-end; flex-wrap:wrap; }
  #fmfind label{ font-size:11px; color:#475569; display:block; margin-bottom:2px; }
  #fmfind input,#fmfind select{ font:inherit; font-size:13px; padding:4px 7px;
        border:1px solid #94a3b8; border-radius:4px; background:#fff; color:#1a1a1a; }
  #fmfind button{ font:inherit; font-size:13px; padding:5px 14px; border-radius:5px; cursor:pointer;
        border:1px solid #334155; background:#334155; color:#fff; font-weight:700; }
  #fmfind button.plain{ background:#fff; color:#334155; font-weight:400; }
  #fmfind .hit{ font-size:12px; color:#475569; margin:6px 0 3px; }
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
    <div><label>品名で探す</label><input id="ff-kw" placeholder="製品名の一部（a12345 なら伝票番号）" autocomplete="off"></div>
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
    '画面_保存':           ['recordId', 'modId', 'fields'],
    '画面_新規案件':       ['種別', '初期値'],
    '画面_新規段階':       ['案件ID', '種別'],
    '画面_一覧':           ['条件']
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
  }

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
    待機(true); 失敗(''); 状態('保存中… ' + n + ' 項目');
    呼ぶ('画面_保存', [現在.recordId, 現在.modId, 差]).then(function (r) {
      if (r.conflict) { 失敗(r.message); 状態('保存できませんでした', 'err'); 待機(false); return; }
      流し込む({ recordId: r.recordId, modId: r.modId, fields: r.fields });
      状態(r.saved.length + ' 項目を保存しました（金額は再計算済み）', 'ok');
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
      + '　' + (r.ミリ秒 / 1000).toFixed(1) + '秒　行をクリックで開きます';

    Array.prototype.forEach.call(box.querySelectorAll('tr.r'), function (tr) {
      tr.onclick = function () {
        if (Object.keys(変更分()).length
            && !confirm('保存していない編集があります。捨てて開きますか？')) return;
        待機(true); 状態('開いています…');
        呼ぶ('画面_recordIdで読む', [tr.getAttribute('data-id')])
          .then(function (x) { 受け取る(x, '開きました'); 探し.style.display = 'none'; })
          .catch(function (e) { 状態(String(e.message || e), 'err'); 待機(false); });
      };
    });
  }

  function 探す() {
    // 伝票番号（a12345 のような形）を品名欄に入れたら、その番号をそのまま開く
    var kw = $('ff-kw').value.trim();
    if (/^[a-zA-Z]\d{4,}$/.test(kw)) { 番号欄.value = kw; $('ff-msg').textContent = '伝票番号として開きます: ' + kw; 読み込む(kw); return; }
    var 条件 = {
      'キーワード': kw,
      '得意先コード': $('ff-cust').value.trim(),
      '段階': $('ff-stage').value,
      '日数': Number($('ff-days').value),
      '件数': Number($('ff-n').value || 50)
    };
    var 絞りなし = !条件['キーワード'] && !条件['得意先コード'] && !条件['段階'];
    if (絞りなし && 条件['日数'] === 0
        && !confirm('絞り込みなしで全部を並べ替えると、45秒ほどかかります。\n\n'
                    + '品名や得意先で絞るか、期間を選ぶとすぐ返ります。続けますか？')) return;
    $('ff-msg').textContent = '探しています…';
    $('ff-go').disabled = true;
    呼ぶ('画面_一覧', [条件])
      .then(function (r) { 一覧を出す(r); })
      .catch(function (e) { $('ff-msg').textContent = String(e.message || e); })
      .then(function () { $('ff-go').disabled = false; });
  }

  btnF.onclick = function () {
    var 開く = 探し.style.display !== 'block';
    探し.style.display = 開く ? 'block' : 'none';
    if (開く) { $('ff-kw').focus(); if (!$('ff-rows').innerHTML) 探す(); }
  };
  $('ff-go').onclick = 探す;
  $('ff-x').onclick = function () { 探し.style.display = 'none'; };
  ['ff-kw', 'ff-cust'].forEach(function (id) {
    $(id).addEventListener('keydown', function (e) { if (e.key === 'Enter') 探す(); });
  });

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
