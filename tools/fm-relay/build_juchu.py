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
  #fmguide{ display:none; background:#f0fdf4; border-bottom:2px solid #15803d; padding:6px 14px; font-size:12px; }
  #fmguide table{ border-collapse:collapse; margin-top:4px; }
  #fmguide th{ background:#bbf7d0; padding:3px 8px; font-weight:600; text-align:right; white-space:nowrap; }
  #fmguide th:first-child{ text-align:left; }
  #fmguide td{ padding:2px 8px; border-bottom:1px solid #dcfce7; text-align:right; white-space:nowrap; }
  #fmguide td:first-child{ text-align:left; }
  #fmguide tr.now td{ background:#fef9c3; font-weight:700; }
  #fmguide tr.pick{ cursor:pointer; } #fmguide tr.pick:hover td{ background:#dcfce7; }
  #fmguide .k{ color:#166534; } #fmguide .warn{ color:#b45309; }
  #fmguide input.n{ width:56px; font-size:11px; text-align:right; padding:1px 3px; border:1px solid #cbd5e1; border-radius:3px; }
  #fmhaiso{ display:none; background:#eef6ff; border-bottom:2px solid #1d4ed8; padding:6px 14px; font-size:12px; }
  #fmhaiso label{ margin-left:10px; } #fmhaiso input{ font-size:12px; padding:2px 4px; border:1px solid #cbd5e1; border-radius:3px; } #fmhaiso button{ font-size:12px; padding:3px 12px; margin-left:8px; background:#1d4ed8; color:#fff; border:0; border-radius:3px; cursor:pointer; }
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
  .fm-changed{ outline:2px solid #dc2626 !important; outline-offset:-2px; background:#fff1f2 !important; }
  #fmrireki{ display:none; background:#fff7ed; border-bottom:2px solid #c2410c; padding:6px 14px; font-size:12px; }
  #fmrireki table{ border-collapse:collapse; } #fmrireki th{ background:#fed7aa; padding:2px 6px; text-align:left; font-weight:600; white-space:nowrap; }
  #fmrireki td{ padding:2px 6px; border-bottom:1px solid #fde68a; white-space:nowrap; max-width:260px; overflow:hidden; text-overflow:ellipsis; }
  #fmrireki .chk{ display:inline-flex; align-items:center; gap:4px; margin-right:12px; padding:2px 8px; border:1px solid #fdba74; border-radius:12px; background:#fff; cursor:pointer; }
  #fmrireki .chk.done{ background:#dcfce7; border-color:#86efac; color:#166534; }
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
  <button class="save" id="fm-save" title="伝票を読み込んでいなければ、打った内容で新しく起こして保存します">保存</button>
  <button id="fm-reload" disabled title="編集を捨てて FileMaker の内容に戻す">読み直す</button>
  <span id="fmwho"></span>
  <span id="fmsignin"></span>
  <span id="fmstat">番号を入れて「読み込む」／何も読み込まずに「新しく起こす」と新規案件</span>
</div>
<div id="fmdiff"></div>
<div id="fmerr"></div>
<div id="fmfind">
  <div class="cond">
    <div><label>何でも検索</label><input id="ff-all" style="width:230px" placeholder="番号・得意先・ユーザー・品名・品種・担当 を全期間から" autocomplete="off" title="伝票番号・見積番号・案件ID・得意先（コードと名前）・ユーザー名・製品名・品種・担当者コード の全部を、期間に関係なく探します。空白で区切ると全部含むもの"></div>
    <div><label>品名で探す</label><input id="ff-kw" placeholder="打つと出ます。a10000 なら伝票番号の前方一致" autocomplete="off"></div>
    <div><label>得意先（コードか名前）</label><input id="ff-cust" style="width:150px" placeholder="5465 か 中尾" autocomplete="off"></div>
    <div><label>ユーザー名</label><input id="ff-user" style="width:120px" placeholder="花井寺" autocomplete="off"></div>
    <div><label>担当者コード</label><input id="ff-tanto" style="width:60px" autocomplete="off"></div>
    <div><label>品種</label><input id="ff-hinshu" style="width:70px" autocomplete="off"></div>
    <div><label>起票日 から／まで</label><input type="date" id="ff-d1" style="width:130px"><input type="date" id="ff-d2" style="width:130px"></div>
    <div><label>納品日 から／まで</label><input type="date" id="ff-n1" style="width:130px"><input type="date" id="ff-n2" style="width:130px"></div>
    <div><label>段階</label>
      <select id="ff-stage">
        <option value="">すべて</option>
        <option>予算見積</option><option>見積</option><option>受注</option><option>失注</option>
      </select></div>
    <div><label>製造指示書</label><label style="display:inline-flex;align-items:center;gap:4px;font-weight:400;cursor:pointer"><input type="checkbox" id="ff-seizo" title="受注のうち、製造指示書をまだ出していないものだけ"> 未出力だけ</label></div>
    <div><label>期間（起票日）</label>
      <select id="ff-days">
        <option value="90">直近3か月</option>
        <option value="365">直近1年</option>
        <option value="1095">直近3年</option>
        <option value="0">すべて（遅い）</option>
      </select></div>
    <div><label>件数</label>
      <select id="ff-n"><option value="0" selected>すべて</option><option>50</option><option>100</option><option>200</option></select></div>
    <button id="ff-go">探す</button>
    <button class="plain" id="ff-x">閉じる</button>
    <span class="hit" id="ff-msg" style="margin-left:auto"></span>
  </div>
  <div class="rows" id="ff-rows" style="display:none"></div>
</div>
<div id="fmguide">
  <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
    <b>💴 価格ガイド</b>
    <span id="pg-src" style="color:#166534"></span>
    <label>種にする伝票 <input id="pg-prev" style="width:80px;font-size:11px" placeholder="前回伝票番号"></label>
    <button id="pg-go" style="font-size:11px;padding:2px 8px">出す</button>
    <span style="margin-left:auto;color:#166534">目安: 昨年 <input class="n" id="pg-u1" value="5">% ／ 一昨年 <input class="n" id="pg-u2" value="10">% ／ それ以前 <input class="n" id="pg-u3" value="20">%　印刷代の固定分 <input class="n" id="pg-pf" value="30">%</span>
  </div>
  <div id="pg-body" style="margin-top:4px;color:#475569">得意先と品名（か前回伝票番号）を入れると、昨年の伝票を種に数量ごとの金額が出ます</div>
</div>
<div id="fmrireki">
  <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
    <b>📜 変更履歴</b><span id="rk-sum" style="color:#9a3412"></span>
    <button id="rk-toggle" style="font-size:11px;padding:2px 8px">全部見る</button>
    <span style="margin-left:auto"></span>
    <b>関連会社の売価（Hub 側）</b>
    <label>単価 <input id="sp-unit" type="number" step="any" style="width:80px"></label>
    <label>金額 <input id="sp-amt" type="number" style="width:100px"></label>
    <button id="sp-save" style="font-size:11px;padding:2px 8px">保存</button>
    <span id="sp-msg" style="color:#166534"></span>
  </div>
  <div id="rk-check" style="margin-top:4px"></div>
  <div id="rk-list" style="display:none;margin-top:4px;max-height:220px;overflow:auto"></div>
</div>
<div id="fmhaiso">
  <b>配送予定（FileMaker の配送カレンダーに登録）</b>
  <label>担当 <input id="hs-tanto" list="hs-tanto-dl" style="width:80px" placeholder="倫子"><datalist id="hs-tanto-dl"><option>倫子</option><option>郵送</option><option>直送</option><option>引取</option><option>宅配</option></datalist></label>
  <label>配送予定日 <input id="hs-date" type="date"></label>
  <label>メモ <input id="hs-memo" style="width:260px" placeholder="納品先・時間など（2 行目に入ります）"></label>
  <button id="hs-go">配送</button>
  <a href="haiso-calendar.html" target="_blank" style="margin-left:6px">📅 配送カレンダーを開く</a>
  <span id="hs-msg" style="color:#1d4ed8"></span>
  <span style="display:inline-block;width:100%;height:4px"></span>
  <b>DTP</b>
  <span style="display:inline-flex;align-items:center;gap:8px;white-space:nowrap">DTP有無 <label style="cursor:pointer"><input type="radio" name="dtp-yn-r" value="" checked> 無</label><label style="cursor:pointer;font-weight:700;color:#5b21b6"><input type="radio" name="dtp-yn-r" value="有"> 有</label></span><input type="hidden" id="dtp-yn" value="">
  <label>校正の内容 <input id="dtp-note" style="width:320px" placeholder="何を校正に出すか（空なら校正BOXに下書きで入ります）"></label>
  <button id="dtp-go" style="background:#7c3aed">校正BOXへ</button>
  <span id="dtp-msg" style="color:#6d28d9"></span>
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
    '画面_案件にまとめる': ['recordIds', '案件ID', '確認'],
    '画面_履歴':           ['recordId', '伝票番号'],
    '先方売価_読む':       ['伝票番号'],
    '先方売価_書く':       ['伝票番号', '会社', '単価', '金額', 'メモ'],
    '画面_Repeat登録':     ['recordId'],
    '画面_削除':           ['recordId', 'modId'],
    '画面_外注':           ['伝票番号'],
    '画面_外注保存':       ['recordId', 'modId', '行'],
    '画面_外注作成':       ['伝票番号', '行'],
    '画面_全項目':         ['recordId'],
    '予定_一覧':           ['開始', '終了'],
    '予定_作る':           ['日付', 'タイトル', '時刻'],
    '予定_保存':           ['recordId', 'modId', 'fields'],
    '予定_削除':           ['recordId'],
    '画面_配送登録':       ['recordId', '担当', '日付', 'メモ'],
    '用紙注文_一覧':       ['件数'],
    '用紙注文_読む':       ['発注番号'],
    '用紙注文_作る':       ['fields'],
    '用紙注文_保存':       ['recordId', 'modId', 'fields'],
    '用紙注文_削除':       ['recordId'],
    'マスタ_配る':         ['layout'],
    'GEN_一覧':            ['画面', '絞り込み', '件数'],
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
  // FMHUB-23: 見積番号・区分（案件区分）は画面の頭に直接置いた欄（FMUSE には無い）
  [['f-mitsuno', '見積番号'], ['f-kubun', '案件区分']].forEach(function (p) { TO_FM[p[0]] = p[1]; (FROM_FM[p[1]] = FROM_FM[p[1]] || []).push(p[0]); });
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
    btnS.disabled = on;   // 伝票が無いときに押すと、新しく起こしてから保存する（FMHUB-24）
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
    札を出す(rec);
    try { calc(); } catch (e) {}
    try { onInk(); } catch (e) {}
    try { applyRowVis(); } catch (e) {}
    try { refreshNote(); } catch (e) {}
  }

  function 札を出す(rec) {
    var 区分 = rec.fields['案件区分'] || '受注';
    var 案件 = String(rec.fields['案件ID'] || '');
    段階札.textContent = 区分 + '  ' + (rec.fields['見積番号'] || rec.fields['伝票番号'] || '') + (案件 ? '　案件 ' + 案件 : '　（案件IDなし）');
    段階札.className = STAGE_CLASS[区分] || '';
    段階札.style.cursor = 'pointer';
    段階札.title = '押すと、この伝票の 案件ID を入れ直せます（同じ案件IDの伝票が「この案件の段階」に並びます）';
    段階札.onclick = function () {
      if (!現在) return;
      var v = prompt('この伝票の 案件ID（予算見積・見積・受注をくくる番号）\n空にすると、この伝票自身の番号を案件IDにします', 案件 || String(rec.fields['伝票番号'] || ''));
      if (v === null) return;
      呼ぶ('画面_案件にまとめる', [[String(現在.recordId)], v.trim(), 0]).then(function (r) {
        現在.fields['案件ID'] = r.案件ID; 札を出す(現在); 履歴を出す(r.履歴); 状態('案件 ' + r.案件ID + ' にしました');
        if (索引) { var P = 索引位置; for (var i = 0; i < 索引.行.length; i++) { if (String(索引.行[i][P['recordId']]) === String(現在.recordId)) 索引.行[i][P['案件ID']] = r.案件ID; } }
      }).catch(function (e) { 状態(String(e.message || e), 'err'); });
    };
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
    得意先名を入れる();
    try { sessionStorage.setItem('fm_last_no', String(r.record.fields['伝票番号'] || r.record.fields['見積番号'] || '')); } catch (e) {}
    履歴を出す(r['履歴']);
    番号欄.value = r.record.fields['見積番号'] || r.record.fields['伝票番号'] || '';
    差分を出す(r['参考'], r['差分']);
    状態(msg + (ms ? '（' + ms + 'ms）' : ''), 'ok');
    待機(false);
    外注を読む(r.record.fields['伝票番号']);
    $('fmhaiso').style.display = 'block'; $('hs-msg').textContent = ''; $('hs-tanto').value = ''; $('hs-date').value = ''; $('hs-memo').value = '';
    $('fmguide').style.display = 'block'; $('pg-prev').value = ''; ガイド種 = null; setTimeout(ガイドを出す, 300);
    DTPを出す(r.record.fields['伝票番号']);
    履歴を読む(r.record.recordId, r.record.fields['伝票番号']);
    先方売価を読む(r.record.fields['伝票番号']);
  }
  // ---- GRP-1: 変更履歴（赤枠・チェックリスト）と関連会社の売価
  function 会社名() { try { var a = JSON.parse(localStorage.getItem('murayama_auth') || '{}'); return String(a.companyName || ''); } catch (e) { return ''; } }
  var 会社の得意先コード = { '村山': '5236', '中尾': '5465', '北上': '5463', 'ヤマウチ': '5451', 'アート': '5427', '津島': '5525' };
  function 自社の得意先コード() { var nm = 会社名(); var hit = ''; Object.keys(会社の得意先コード).forEach(function (k) { if (nm.indexOf(k) >= 0) hit = 会社の得意先コード[k]; }); return hit; }
  var 重要語 = ['数', '納期', '納品', '製品名', 'サイズ', '横', '縦', '色', '用紙', '紙', '加工', 'パーツ', '仕様', '版', '単価', '金額'];
  function 履歴を読む(recordId, no) {
    var box = $('fmrireki'); if (!box) return;
    Array.prototype.forEach.call(document.querySelectorAll('.fm-changed'), function (el) { el.classList.remove('fm-changed'); el.title = ''; });
    $('rk-sum').textContent = '読んでいます…'; $('rk-list').innerHTML = ''; $('rk-check').innerHTML = ''; box.style.display = 'block';
    呼ぶ('画面_履歴', [String(recordId), no]).then(function (r) {
      var 行 = r.行 || []; var 週 = Date.now() - 7 * 24 * 3600 * 1000; var 最近 = 行.filter(function (h) { return new Date(h.日時).getTime() >= 週; });
      if (!行.length) { $('rk-sum').textContent = 'Hub からの変更はまだありません（FileMaker で直した分は載りません）'; }
      else { var l = 行[0]; $('rk-sum').textContent = '直近 7 日で ' + 最近.length + ' 項目 ／ 全部で ' + 行.length + ' 項目。最後: ' + 日時短(l.日時) + ' ' + esc(l.誰.split('@')[0]) + ' が ' + esc(l.項目); }
      // 欄に赤枠（7 日以内）
      var 重要 = false;
      最近.forEach(function (h) { (FROM_FM[h.項目] || []).forEach(function (id) { var el = document.getElementById(id); if (!el) return; el.classList.add('fm-changed'); el.title = 日時短(h.日時) + ' ' + h.誰 + ' が変更: 「' + (h.前 == null ? '' : h.前) + '」→「' + h.後 + '」'; }); if (重要語.some(function (w) { return String(h.項目).indexOf(w) >= 0; })) 重要 = true; });
      // 出し直しチェック（数量・仕様・納期・金額に変更があったとき）
      if (重要) {
        var key = 'fm_check_' + no + '_' + (最近[0] ? 最近[0].日時.slice(0, 10) : ''); var st = {}; try { st = JSON.parse(localStorage.getItem(key) || '{}'); } catch (e) {}
        var items = ['外注指示書を出し直した', '内製指示書を出し直した', '外注先へ変更を連絡した', '関連会社へ変更を連絡した'];
        $('rk-check').innerHTML = '<span style="color:#9a3412;font-weight:700">⚠ 数量・仕様・納期・金額のどれかが 7 日以内に変わっています。伝え漏れの確認:</span> ' + items.map(function (t, i) { return '<label class="chk' + (st[i] ? ' done' : '') + '"><input type="checkbox" data-i="' + i + '"' + (st[i] ? ' checked' : '') + '> ' + esc(t) + '</label>'; }).join('');
        Array.prototype.forEach.call($('rk-check').querySelectorAll('input'), function (ck) { ck.onchange = function () { st[ck.getAttribute('data-i')] = ck.checked; try { localStorage.setItem(key, JSON.stringify(st)); } catch (e) {} ck.parentNode.classList.toggle('done', ck.checked); }; });
      }
      var h = '<table><tr><th>いつ</th><th>誰</th><th>項目</th><th>前</th><th>後</th></tr>';
      行.slice(0, 200).forEach(function (x) { var 古い = new Date(x.日時).getTime() < 週; h += '<tr' + (古い ? '' : ' style="color:#b91c1c;font-weight:700"') + '><td>' + esc(日時短(x.日時)) + '</td><td>' + esc(String(x.誰).split('@')[0]) + '</td><td>' + esc(x.項目) + '</td><td title="' + esc(x.前 == null ? '' : x.前) + '">' + esc(String(x.前 == null ? '' : x.前).slice(0, 30)) + '</td><td title="' + esc(x.後) + '">' + esc(String(x.後).slice(0, 30)) + '</td></tr>'; });
      $('rk-list').innerHTML = h + '</table>';
    }).catch(function (e) { $('rk-sum').textContent = '履歴を読めませんでした: ' + String(e.message || e); });
  }
  function 日時短(iso) { var d = new Date(iso); if (isNaN(d.getTime())) return String(iso); return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
  $('rk-toggle').onclick = function () { var l = $('rk-list'); var open = l.style.display === 'none'; l.style.display = open ? 'block' : 'none'; $('rk-toggle').textContent = open ? '閉じる' : '全部見る'; };
  function 先方売価を読む(no) {
    $('sp-unit').value = ''; $('sp-amt').value = ''; $('sp-msg').textContent = '';
    呼ぶ('先方売価_読む', [no]).then(function (r) {
      var 行 = r.行 || []; if (!行.length) return; var my = 会社名(); var hit = 行.filter(function (x) { return my && String(x.会社) === my; })[0] || 行[0];
      $('sp-unit').value = hit.単価 === '' ? '' : hit.単価; $('sp-amt').value = hit.金額 === '' ? '' : hit.金額;
      $('sp-msg').textContent = (hit.会社 ? hit.会社 + '　' : '') + (hit.更新日 ? 日時短(hit.更新日) + ' ' + String(hit.更新者 || '').split('@')[0] : '');
    }).catch(function () {});
  }
  $('sp-save').onclick = function () {
    if (!現在) { alert('先に伝票を開いてください'); return; }
    var no = String(現在.fields['伝票番号'] || 現在.fields['見積番号'] || ''); var 会社 = 会社名() || 'トキワ印刷';
    $('sp-msg').textContent = '保存中…';
    呼ぶ('先方売価_書く', [no, 会社, $('sp-unit').value, $('sp-amt').value, '']).then(function () { $('sp-msg').textContent = '保存しました（' + 会社 + '）'; }).catch(function (e) { $('sp-msg').textContent = String(e.message || e); });
  };
  // 得意先コード → 得意先名（得意先マスタ）。FileMaker の画面は名前欄がコードから引く作りなので、こちらも同じに
  function 得意先名を入れる() {
    var cd = $('f-custcd') ? $('f-custcd').value.trim() : '', box = $('f-cust'); if (!box) return;
    if (!cd) { box.value = ''; return; }
    得意先マスタを用意().then(function () {
      var nm = 得意先名(cd);
      if (nm) { box.value = nm; box.title = '得意先マスタ ' + cd; try { box.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {} }
      else { box.value = ''; box.placeholder = 'コード ' + cd + ' はマスタにありません'; }
    }).catch(function () {});
  }
  if ($('f-custcd')) { $('f-custcd').addEventListener('change', 得意先名を入れる); $('f-custcd').addEventListener('blur', 得意先名を入れる); }
  // -------------------------------------------------- 💴 価格ガイド（FMHUB-16）
  var ガイド種 = null;   // 種にした前回伝票 { fields, 外注合計 }
  function 数値(v){ var x = Number(String(v == null ? '' : v).replace(/,/g, '')); return isNaN(x) ? 0 : x; }
  function 円整(v){ return Math.round(v).toLocaleString(); }
  function ガイドを消す(){ ガイド種 = null; $('pg-body').innerHTML = '得意先と品名（か前回伝票番号）を入れると、昨年の伝票を種に数量ごとの金額が出ます'; $('pg-src').textContent = ''; }
  // 種を決める: 前回伝票番号 → 無ければ手元の索引で 同じ得意先コード＋同じ製品名 の最新（自分以外）
  function 種の番号(){
    var no = $('pg-prev').value.trim() || ($('f-lotno') ? $('f-lotno').value.trim() : '');
    if (no) return no;
    if (!索引) return '';
    var cust = $('f-custcd') ? $('f-custcd').value.trim() : '', item = $('f-item') ? $('f-item').value.trim() : '';
    var me = 現在 ? String(現在.fields['伝票番号'] || '') : '';
    if (!cust || !item) return '';
    var P = 索引位置, best = -1, bestKey = 0;
    for (var i = 0; i < 索引.行.length; i++) { var r = 索引.行[i];
      if (String(r[P['得意先コード']]) !== cust) continue; if (String(r[P['製品名']]) !== item) continue; if (String(r[P['伝票番号']]) === me) continue;
      if (String(r[P['案件区分']] || '') && String(r[P['案件区分']]) !== '受注') continue;
      if (索引日[i] > bestKey) { bestKey = 索引日[i]; best = i; } }
    return best >= 0 ? String(索引.行[best][P['伝票番号']]) : '';
  }
  function ガイドを出す(){
    var no = 種の番号(); if (!no) { ガイドを消す(); return; }
    if (ガイド種 && ガイド種.番号 === no) { ガイドを描く(); return; }
    $('pg-body').textContent = no + ' を読んでいます…';
    呼ぶ('画面_読み込み', [no]).then(function (r) {
      if (!r.record) throw new Error(no + ' が見つかりません');
      ガイド種 = { 番号: no, fields: r.record.fields };
      ガイドを描く();
    }).catch(function (e) { $('pg-body').textContent = String(e.message || e); });
  }
  function ガイドを描く(){
    var f = ガイド種.fields;
    var q0 = 数値(f['ロット契約単位']) || 数値(f['合計数1']) || 1;
    var 版 = 数値(f['版代']), 用紙 = 数値(f['用紙代']), 印刷 = 数値(f['印刷代']), 加工 = 数値(f['加工賃']), 梱包 = 数値(f['梱包代']), 配送 = 数値(f['配送代']), 人件 = 数値(f['人件費']);
    var 原価0 = 数値(f['合計金額']); var 外注0 = Math.max(0, 原価0 - (版 + 用紙 + 印刷 + 加工 + 梱包 + 配送 + 人件));
    var 売価0 = 数値(f['売価金額']) || (数値(f['売価単価']) * q0); var 単価0 = q0 ? 売価0 / q0 : 0;
    var 率0 = 売価0 ? 原価0 / 売価0 : 0;
    // 経過年の目安
    var m = /^(\d\d)\/(\d\d)\/(\d{4})$/.exec(String(f['起票日'] || '')); var y0 = m ? Number(m[3]) : 0; var yNow = new Date().getFullYear();
    var 経過 = y0 ? (yNow - y0) : 1;
    var u = 経過 <= 1 ? 数値($('pg-u1').value) : 経過 === 2 ? 数値($('pg-u2').value) : 数値($('pg-u3').value);
    // 用紙差: 種の 用紙単価n と、いまのフォームの 用紙単価n（紙質で引いた最新）を比べる
    var 用紙差 = 0, 用紙注 = '';
    try { var a = 0, bb = 0; for (var i = 1; i <= 9; i++) { var pu = 数値(f['用紙単価' + i]); var cu = 数値(($('p' + i + '-up') || {}).value); if (pu && cu) { a += pu; bb += cu; } }
      if (a && bb) { 用紙差 = (bb / a - 1) * 100; 用紙注 = '用紙単価 ' + a.toFixed(2) + ' → ' + bb.toFixed(2) + '（' + (用紙差 >= 0 ? '+' : '') + 用紙差.toFixed(1) + '%）'; } } catch (e) {}
    var 上げ = Math.max(u, 用紙差);   // 「用紙差以上」を保証
    var pf = Math.min(100, Math.max(0, 数値($('pg-pf').value))) / 100;
    var qNow = 数値(($('f-lotunit') || {}).value) || q0;
    var 階段 = [500, 1000, 2000, 3000, 5000, 10000, qNow, Math.round(qNow * 0.8), Math.round(qNow * 1.2), Math.round(qNow * 0.5), Math.round(qNow * 1.5)]
      .filter(function (x, i, arr) { return x > 0 && arr.indexOf(x) === i; }).sort(function (a, b) { return a - b; });
    var rows = 階段.map(function (n) {
      var k = n / q0;
      var 用紙n = 用紙 * k * (1 + 用紙差 / 100), 印刷n = 印刷 * (pf + (1 - pf) * k), 加工n = 加工 * k, 外注n = 外注0 * k, 梱包n = (梱包 + 配送) * k, 人件n = 人件 * k;
      var 原価n = 版 + 用紙n + 印刷n + 加工n + 外注n + 梱包n + 人件n;
      var 売価n = 率0 ? (原価n / 率0) : 原価n * 1.5;   // 昨年の原価率を保つ
      売価n = 売価n * (1 + 上げ / 100);
      var 単価n = Math.round((売価n / n) * 10) / 10; 売価n = 単価n * n;
      var 粗利 = 売価n ? (1 - 原価n / 売価n) * 100 : 0;
      return { n: n, 原価: 原価n, 売価: 売価n, 単価: 単価n, 粗利: 粗利, 前年比: 単価0 ? (単価n / 単価0 - 1) * 100 : 0 };
    });
    var h = '<div><span class="k">種:</span> <b>' + esc(ガイド種.番号) + '</b> ' + esc(f['製品名'] || '') + '　起票 ' + esc(日付(f['起票日'])) + '（' + 経過 + ' 年前 → 目安 +' + u + '%）'
      + '　数量 ' + 円整(q0) + '　単価 ' + (単価0 ? 単価0.toFixed(1) : '—') + '　売価 ¥' + 円整(売価0) + '　原価 ¥' + 円整(原価0) + '　原価率 ' + (率0 * 100).toFixed(1) + '%'
      + (用紙注 ? '　<span class="warn">' + esc(用紙注) + '</span>' : '　<span style="color:#94a3b8">（用紙差は、いまの用紙単価が入っていれば出ます）</span>')
      + '　<span class="k">今回の上げ幅 <b>+' + 上げ.toFixed(1) + '%</b></span></div>'
      + '<div style="color:#64748b;font-size:11px">内訳（種）: 版 ' + 円整(版) + '／用紙 ' + 円整(用紙) + '／印刷 ' + 円整(印刷) + '／加工 ' + 円整(加工) + '／外注 ' + 円整(外注0) + '／梱包・配送 ' + 円整(梱包 + 配送) + '　※版代は固定、印刷代は ' + Math.round(pf * 100) + '% 固定、ほかは数量比例。段をクリックで数量と単価をフォームへ</div>'
      + '<table><thead><tr><th>数量</th><th>原価</th><th>売価</th><th>単価</th><th>粗利率</th><th>前回単価比</th></tr></thead><tbody>'
      + rows.map(function (r) { return '<tr class="pick' + (r.n === qNow ? ' now' : '') + '" data-n="' + r.n + '" data-u="' + r.単価 + '"><td>' + 円整(r.n) + (r.n === qNow ? ' ◀ 今回' : '') + '</td><td>¥' + 円整(r.原価) + '</td><td>¥' + 円整(r.売価) + '</td><td>' + r.単価.toFixed(1) + '</td><td>' + r.粗利.toFixed(1) + '%</td><td>' + (r.前年比 >= 0 ? '+' : '') + r.前年比.toFixed(1) + '%</td></tr>'; }).join('')
      + '</tbody></table>';
    $('pg-body').innerHTML = h + '<div id="pg-quotes" style="margin-top:6px;color:#475569">前回の見積書を探しています…</div>'; $('pg-src').textContent = '';
    見積実績を出す(f);
    Array.prototype.forEach.call($('pg-body').querySelectorAll('tr.pick'), function (tr) {
      tr.onclick = function () {
        var n = Number(tr.getAttribute('data-n')), u2 = Number(tr.getAttribute('data-u'));
        if ($('f-lotunit')) { $('f-lotunit').value = n; $('f-lotunit').dispatchEvent(new Event('input', { bubbles: true })); }
        if ($('f-price')) { $('f-price').value = u2; $('f-price').dispatchEvent(new Event('input', { bubbles: true })); }
        if ($('f-amt')) { $('f-amt').value = Math.round(u2 * n); }
        try { if (typeof calc === 'function') calc(); } catch (e) {}
        ガイドを描く();
      };
    });
  }
  // ---- 前回の見積書（保管庫「見積実績」）: 得意先名＋品名で引いて、受注との突合結果を並べる
  var 得意先マスタ = null;
  function 得意先マスタを用意() {
    if (得意先マスタ) return Promise.resolve(得意先マスタ);
    try { var c = JSON.parse(localStorage.getItem('fm_master_得意先マスタ') || 'null'); if (c && c.取った && Date.now() - new Date(c.取った).getTime() < 24 * 3600 * 1000) { 得意先マスタ = c; return Promise.resolve(c); } } catch (e) {}
    return 呼ぶ('マスタ_配る', ['得意先マスタ']).then(function (j) { j.取った = new Date().toISOString(); 得意先マスタ = j; try { localStorage.setItem('fm_master_得意先マスタ', JSON.stringify(j)); } catch (e) {} return j; });
  }
  function 得意先名(code) { var m = 得意先マスタ; if (!m) return ''; var h = m.行.filter(function (r) { return String(r['得意先コード']) === String(code); })[0]; return h ? String(h['得意先名'] || '') : ''; }
  function 名の芯(s) { return String(s || '').normalize('NFKC').replace(/(株式会社|有限会社|合同会社|\(株\)|\(有\)|㈱|㈲|様|御中)/g, '').replace(/[\s　・･\-ー－/／_（）()]/g, ''); }
  function 見積実績を出す(f) {
    var box = function () { return $('pg-quotes'); };
    得意先マスタを用意().then(function () {
      var name = 得意先名(f['得意先コード']) || String(($('f-cust') || {}).value || '');
      var user = String(f['ユーザー名'] || ($('f-user') || {}).value || '');
      // 見積書の宛先はユーザー（花井寺 など）のことが多く、FileMaker の得意先は代理店（中尾印刷 など）。両方で引く
      var keys = []; [user, name].forEach(function (nm) { var kk = 名の芯(nm).slice(0, 6); if (kk && keys.indexOf(kk) < 0) keys.push(kk); });
      if (!keys.length) { if (box()) box().textContent = '前回の見積書: 得意先名が分からないので探せません'; return; }
      if (user) name = user + '（' + name + '）';
      return Promise.all(keys.map(function (kk) { return 呼ぶ('GEN_一覧', ['見積実績', { 得意先: kk }, 0]).then(function (r) { return r.行 || []; }); })).then(function (lists) {
        var rows = [], seen = {}; lists.forEach(function (l) { l.forEach(function (q) { var id = q.file + '#' + q.行; if (!seen[id]) { seen[id] = 1; rows.push(q); } }); });
        var item = 名の芯(f['製品名'] || ($('f-item') || {}).value || '');
        var scored = rows.map(function (q) {
          var qn = 名の芯(q['品名']); var sim = 0;
          if (item && qn) { if (qn.indexOf(item) >= 0 || item.indexOf(qn) >= 0) sim = 1; else { var a = item.slice(0, 4), b2 = qn.slice(0, 4); sim = (a && qn.indexOf(a) >= 0) || (b2 && item.indexOf(b2) >= 0) ? 0.6 : 0; } }
          return { q: q, sim: sim };
        }).filter(function (x) { return x.sim > 0; }).sort(function (a, b) { return (b.sim - a.sim) || String(b.q['見積日']).localeCompare(String(a.q['見積日'])); }).slice(0, 6);
        if (!box()) return;
        if (!scored.length) { box().innerHTML = '<span style="color:#94a3b8">前回の見積書: ' + esc(name) + ' でこの品名の見積書は見つかりません（保管庫「見積実績」に ' + rows.length + ' 件）</span>'; return; }
        var h = '<div><b style="color:#166534">前回の見積書</b>（Excel から読んだもの ↔ FileMaker の受注）</div><table><thead><tr><th style="text-align:left">見積日</th><th style="text-align:left">品名</th><th>数量</th><th>単価</th><th style="text-align:left">受注</th><th>受注単価</th><th style="text-align:left">結果</th></tr></thead><tbody>';
        scored.forEach(function (x) { var q = x.q; var res = String(q['結果'] || ''); var col = res === '一致' ? '#166534' : res === '金額違い' ? '#b45309' : '#64748b';
          h += '<tr><td style="text-align:left">' + esc(String(q['見積日'] || '').slice(0, 10)) + '</td><td style="text-align:left">' + esc(String(q['品名'] || '').slice(0, 24)) + '</td><td>' + esc(円整(Number(q['数量'] || 0))) + '</td><td>' + esc(q['単価'] == null || q['単価'] === '' ? '—' : Number(q['単価']).toLocaleString()) + '</td><td style="text-align:left">' + esc(q['伝票番号'] || '—') + '</td><td>' + esc(q['受注単価'] == null || q['受注単価'] === '' ? '—' : Number(q['受注単価']).toLocaleString()) + '</td><td style="text-align:left;color:' + col + ';font-weight:700">' + esc(res) + (res === '一致' ? '　← この金額を前回金額として使えます' : '') + '</td></tr>'; });
        h += '</tbody></table>';
        box().innerHTML = h;
      });
    }).catch(function (e) { if (box()) box().textContent = '前回の見積書: ' + String(e.message || e); });
  }
  ['f-custcd', 'f-item', 'f-lotno', 'f-lotunit'].forEach(function (id) { var el = $(id); if (!el) return; el.addEventListener('change', function () { if (id === 'f-lotunit' && ガイド種) ガイドを描く(); else ガイドを出す(); }); });
  ['pg-u1', 'pg-u2', 'pg-u3', 'pg-pf'].forEach(function (id) { $(id).addEventListener('change', function () { if (ガイド種) ガイドを描く(); }); });
  $('pg-go').onclick = function () { ガイド種 = null; ガイドを出す(); };
  $('pg-prev').addEventListener('keydown', function (e) { if (e.key === 'Enter') { ガイド種 = null; ガイドを出す(); } });

  // -------------------------------------------------- DTP有無 → 校正BOX（本体）へ
  function DTP記録() { try { return JSON.parse(localStorage.getItem('fm_dtp') || '{}'); } catch (e) { return {}; } }
  // KOSEI-DTP-2: ラジオ（無／有）。値は hidden #dtp-yn に集め、今までの処理はそのまま
  function DTPラジオ同期() { var v = $('dtp-yn').value; Array.prototype.forEach.call(document.querySelectorAll('input[name="dtp-yn-r"]'), function (r) { r.checked = (r.value === v); }); }
  Array.prototype.forEach.call(document.querySelectorAll('input[name="dtp-yn-r"]'), function (r) { r.addEventListener('change', function () { if (!r.checked) return; $('dtp-yn').value = r.value; $('dtp-yn').dispatchEvent(new Event('change')); }); });
  function DTPを出す(no) {
    var m = DTP記録()[no] || {};
    $('dtp-yn').value = m.dtp || ''; $('dtp-note').value = m.note || ''; DTPラジオ同期();
    $('dtp-msg').textContent = m.at ? ('校正BOXへ ' + new Date(m.at).toLocaleString('ja-JP') + (m.draft ? '（下書き）' : '')) : '';
  }
  // KOSEI-DTP-1: 伝票の値（fields か 一覧の行）から校正BOXへ送る。無にしたら記録を消す。戻り値は表示用の文
  function 校正まとめ名(items){
    var names=(items||[]).map(function(x){ return String((x&&(x.製品名||x.name))||'').trim(); }).filter(Boolean);
    if(!names.length) return '';
    if(names.length===1) return names[0];
    var pre=names[0].split(/[（(]/)[0].trim();
    var inner=names.map(function(n){ var m=n.match(/[（(](.+?)[）)]/); return (m?m[1]:n).replace(/様$/,'').trim(); });
    if(pre && names.every(function(n){ return n.indexOf(pre)===0; })) return pre+' '+names.length+'件（'+inner.join('・')+'）';
    return names[0]+' ほか'+(names.length-1)+'件';
  }
  function DTP送信(f, yn, note, 一覧, 明細) {
    var no = String(f['伝票番号'] || ''); if (!no) return '';
    var all = DTP記録();
    if (yn !== '有') { delete all[no]; try { localStorage.setItem('fm_dtp', JSON.stringify(all)); } catch (e) {} return 'DTP 無にしました'; }
    var item = { 伝票番号: no, 前回伝票番号: String(f['前回伝票番号'] || ''), 得意先コード: String(f['得意先コード'] || ''), ユーザー名: String(f['ユーザー名'] || ''), 製品名: String(f['製品名'] || ''),
                 納期: String(f['納期'] || ''), 起票日: String(f['起票日'] || ''), note: note || '', dtp: '有', draft: !note, at: new Date().toISOString(),
                 user: (window.FM名乗っている ? FM名乗っている() : '') };
    if (一覧 && 一覧.length > 1) { item.伝票一覧 = 一覧.map(String); if (明細 && 明細.length) item.伝票明細 = 明細; item.製品名 = 校正まとめ名(明細 && 明細.length ? 明細 : 一覧.map(function (n) { return { 製品名: n === no ? String(f['製品名'] || '') : '' }; })) || String(f['製品名'] || ''); }
    all[no] = item;
    if (一覧 && 一覧.length > 1) 一覧.forEach(function (n) { all[String(n)] = Object.assign({}, item, { 伝票番号: String(n) }); });
    try { localStorage.setItem('fm_dtp', JSON.stringify(all)); } catch (e) {}
    // 本体が拾う待ち行列（伝票番号で 1 件）
    var q = []; try { q = JSON.parse(localStorage.getItem('fm_dtp_pending') || '[]'); } catch (e) {}
    q = q.filter(function (x) { return x.伝票番号 !== no; }); q.push(item);
    try { localStorage.setItem('fm_dtp_pending', JSON.stringify(q)); } catch (e) {}
    try { new BroadcastChannel('tokiwa-hub-tools').postMessage({ type: 'dtp', 伝票番号: no }); } catch (e) {}
    return '校正BOXへ送りました' + (note ? '' : '（内容が空なので下書き）') + '。本体を開いていれば今、閉じていれば次に開いたときにカードになります';
  }
  // SEIZO-1: 製造指示書の出力記録（本体の DB.sagyoPrints）。伝票番号 → 最後の記録 { n, at, by, comment }
  var 製造記録 = {};
  function 製造記録を読む() {
    return new Promise(function (res) {
      try { var r = indexedDB.open('tokiwa_hub_local', 1);
        r.onupgradeneeded = function (e) { try { var d = e.target.result; if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv'); } catch (x) {} };
        r.onsuccess = function () { try { var d = r.result, q = d.transaction('kv', 'readonly').objectStore('kv').get('db');
          q.onsuccess = function () { var v = q.result; d.close(); var db = null; if (v && v.json) { try { db = JSON.parse(v.json); } catch (e) {} } res(db); }; q.onerror = function () { d.close(); res(null); }; } catch (e) { res(null); } };
        r.onerror = function () { res(null); };
      } catch (e) { res(null); }
    }).then(function (db) {
      if (!db) { try { db = JSON.parse(localStorage.getItem('murayama_v15') || 'null'); } catch (e) { db = null; } }
      var m = {};
      ((db && db.sagyoPrints) || []).forEach(function (r) { if (!r || !r.fmNo) return; var k = String(r.fmNo); if (!m[k] || String(r.at || '') > String(m[k].at || '')) m[k] = { n: r.n, at: r.at, by: r.by, comment: r.comment }; });
      try { (JSON.parse(localStorage.getItem('fm_sagyo_pending') || '[]')).forEach(function (r) { if (!r || !r.fmNo) return; var k = String(r.fmNo); if (!m[k] || String(r.at || '') > String(m[k].at || '')) m[k] = { n: r.n, at: r.at, by: r.by, comment: r.comment }; }); } catch (e) {}
      製造記録 = m; return m;
    });
  }
  function 製造指示書状態(no) { return 製造記録[String(no || '')] || null; }
  製造記録を読む().then(function () { try { if (最後の件数) 手元で探す(false); } catch (e) {} });
  setInterval(function () { 製造記録を読む(); }, 60 * 1000);
  try { new BroadcastChannel('tokiwa-hub-tools').onmessage = function (ev) { if (ev.data && (ev.data.type === 'sagyo' || ev.data.type === 'db-updated')) 製造記録を読む().then(function () { try { if (最後の件数) 手元で探す(false); } catch (e) {} }); }; } catch (e) {}
  // 校正BOX に入っているか（本体の DB は同じブラウザの localStorage にある）。'card'＝カードあり／'pending'＝送信済みで本体待ち／''＝無し
  function DTP状態(no) {
    try { var db = JSON.parse(localStorage.getItem('murayama_v15') || 'null'); if (db && (db.proofings || []).some(function (p) { return p && (String(p.fmNo || '') === String(no) || (p.fmNos || []).map(String).indexOf(String(no)) >= 0); })) return 'card'; } catch (e) {}
    try { if ((JSON.parse(localStorage.getItem('fm_dtp_pending') || '[]')).some(function (x) { return String(x.伝票番号) === String(no); })) return 'pending'; } catch (e) {}
    var m = DTP記録()[no]; return (m && m.dtp === '有') ? 'sent' : '';
  }
  function DTPを送る() {
    if (!現在) return;
    $('dtp-msg').textContent = DTP送信(現在.fields, $('dtp-yn').value, $('dtp-note').value.trim());
  }
  $('dtp-go').onclick = DTPを送る;
  // 有 を選んだ瞬間に送る（押し忘れで校正BOXに入らない、を無くす）。内容は後から入れて「校正BOXへ」で送り直せる
  $('dtp-yn').addEventListener('change', function () { DTPを送る(); if ($('dtp-yn').value === '有') $('dtp-note').focus(); });
  window.DTP送信 = DTP送信; window.DTP状態 = DTP状態;
  $('hs-go').onclick = function () {
    if (!現在) return;
    var 担当 = $('hs-tanto').value.trim(), d = $('hs-date').value, メモ = $('hs-memo').value.trim();
    if (!d) { $('hs-msg').textContent = '配送予定日を入れてください'; return; }
    var fm = d.split('-'); var 日付 = fm[1] + '/' + fm[2] + '/' + fm[0];
    if (!confirm(日付 + ' の配送カレンダーに登録します。\n\n' + String(現在.fields['伝票番号'] || '') + ' ' + String(現在.fields['製品名'] || '') + ' ' + 担当 + (メモ ? '\n' + メモ : ''))) return;
    $('hs-msg').textContent = '登録しています…';
    呼ぶ('画面_配送登録', [現在.recordId, 担当, 日付, メモ]).then(function (r) {
      $('hs-msg').textContent = '登録しました: ' + (r.予定 ? r.予定.タイトル.split(/\r?\n/)[0] : '') + (r.受注側 ? '' : '（受注側の配送予定日は入りませんでした）');
    }).catch(function (e) { $('hs-msg').textContent = String(e.message || e); });
  };

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
      if (!confirm(文)) { 起こした後 = null; return; }

      待機(true); 失敗(''); diff.style.display = 'none';
      状態((案件ID ? '起こしています… ' : '新規案件を起こしています… ') + 種別);
      var t0 = Date.now();
      var p = 案件ID ? 呼ぶ('画面_新規段階', [案件ID, 種別])
                     : 呼ぶ('画面_新規案件', [種別, {}]);
      p.then(function (r) {
        var no = r.record.fields['見積番号'] || r.record.fields['伝票番号'] || '';
        受け取る(r, 種別 + ' を起こしました  ' + no, Date.now() - t0);
        if (起こした後) { var f = 起こした後; 起こした後 = null; try { f(); } catch (e) {} }
      }).catch(function (e) { 状態(String(e.message || e), 'err'); 待機(false); 起こした後 = null; });
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

  // 起こしたあとに続けてやること（空の画面から保存したとき）
  var 起こした後 = null;
  function 空から起こして保存() {
    var 値 = {};
    Object.keys(TO_FM).forEach(function (id) { var el = document.getElementById(id); if (!el) return; var v = String(el.value == null ? '' : el.value).trim(); if (v !== '' && v !== String(画面の初期値[id] == null ? '' : 画面の初期値[id]).trim()) 値[id] = el.value; });
    if (!Object.keys(値).length) { alert('内容を入れてから「保存」を押してください（伝票番号は自動で付きます）。\n先に空の伝票を起こすなら緑の「新規作成」です'); return; }
    起こした後 = function () {
      var n = 0;
      Object.keys(値).forEach(function (id) { var el = document.getElementById(id); if (!el) return; if (String(読込時[id] || '') !== String(値[id])) { el.value = 値[id]; el.classList.add('fm-dirty'); n++; } });
      if (n) { try { calc(); } catch (e) {} 保存(); } else { 状態('起こしました（打った内容は最初から入っていました）', 'ok'); }
    };
    if (モード === 'mitsu') { 種別を選んで起こす(); return; }
    var n = document.querySelector('#fmbar button.new[data-kind="' + 起こす種別 + '"]') || document.querySelector('#fmbar button.new');
    if (n) n.click();
  }
  function 保存() {
    if (!現在) { 空から起こして保存(); return; }
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
    { c:'案件ID',     h:'案件' },
    { c:'起票日',     h:'起票日', date:true },
    { c:'得意先コード', h:'得意先' },
    { c:'製品名',     h:'製品名' },
    { c:'品種',       h:'品種' },
    { c:'合計数1',    h:'数量', num:true },
    { c:'売価金額',   h:'売価', money:true },
    { c:'合計金額',   h:'原価', money:true },
    { c:'納品日',     h:'納品日', date:true },
    { c:'注残数',     h:'注残', num:true },
    { c:'_dtp',       h:'DTP', dtp:true },   // KOSEI-DTP-1: 有にすると校正BOXへ
    { c:'_sagyo',     h:'指示書', sagyo:true }, // SAGYO-2: 外注／製造 の指示書を別タブで
    { c:'_seizo',     h:'製造指示書', seizo:true } // SEIZO-1: 未出力／第N回 出力日
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

  var 最後の件数 = 0;
  function 結果を畳む() {
    var box = $('ff-rows'); if (!box || box.style.display === 'none') return;
    box.style.display = 'none';
    var old = document.getElementById('ff-fold'); if (old) old.remove();
    var bar = document.createElement('div'); bar.id = 'ff-fold';
    bar.style.cssText = 'margin:4px 0;padding:5px 10px;background:#e2e8f0;border-radius:6px;font-size:12px;cursor:pointer;color:#1e293b;font-weight:700';
    bar.textContent = '▸ 検索結果（' + 最後の件数.toLocaleString() + ' 件）を開く';
    bar.onclick = function () { box.style.display = 'block'; bar.remove(); };
    box.parentNode.insertBefore(bar, box);
  }
  function 一覧を出す(r) {
    var box = $('ff-rows');
    var fold = document.getElementById('ff-fold'); if (fold) fold.remove();
    最後の件数 = (r && r.行) ? r.行.length : 0;
    if (!r.行 || !r.行.length) {
      box.style.display = 'none';
      $('ff-msg').textContent = '見つかりませんでした';
      return;
    }
    var h = '<div style="display:flex;gap:8px;align-items:center;margin:2px 0 4px;font-size:12px">'
      + '<button id="ff-group" style="padding:3px 10px" title="チェックした伝票の 案件ID を同じにします（空なら いちばん古い受注の伝票番号）">☑ 選んだ伝票を 1 つの案件にまとめる</button>'
      + '<input id="ff-group-id" placeholder="案件ID（空なら自動）" style="width:150px;padding:3px 6px"><span style="color:#64748b">「案件」列が同じ伝票が、予算見積→見積→受注の 1 つの案件です</span>'
      + '<button id="ff-proof-group" style="padding:3px 10px;margin-left:auto;background:#5b21b6;color:#fff;border:1px solid #4c1d95;border-radius:4px" title="チェックした伝票を 1 枚の校正カードにまとめて校正BOXへ（名刺 4 件を一緒に校正するときなど）">📎 選んだ伝票を 1 つの校正にまとめて校正BOXへ</button></div>';
    h += '<table><thead><tr><th></th><th></th>';
    列.forEach(function (k) { h += '<th>' + esc(k.h) + '</th>'; });
    h += '</tr></thead><tbody>';
    var 一度に = 500, 描いた = Math.min(一度に, r.行.length);
    function 行の札(row) {
      var t = '<tr class="r" data-id="' + esc(row.recordId) + '">';
      t += '<td onclick="event.stopPropagation()"><input type="checkbox" class="pick" data-id="' + esc(row.recordId) + '"></td>';
      t += '<td><button type="button" class="open" data-id="' + esc(row.recordId) + '" style="font:inherit;font-size:11px;font-weight:700;padding:2px 10px;border:1.5px solid #fff;outline:1px solid #1a1a1a;border-radius:4px;background:#1a1a1a;color:#fff;cursor:pointer;white-space:nowrap">表示</button></td>';
      列.forEach(function (k) {
        var v = row[k.c];
        if (k.sagyo) { var sn = encodeURIComponent(String(row['伝票番号'] || '')); t += '<td onclick="event.stopPropagation()" style="white-space:nowrap;font-size:11px"><a href="sagyo.html?no=' + sn + '" target="_blank" rel="noopener" title="外注指示書（FileMaker と同じ紙）" style="color:#0369a1">🖨外注</a> <a href="sagyo.html?no=' + sn + '&type=seizo" target="_blank" rel="noopener" title="製造指示書（内製用）" style="color:#0369a1;margin-left:4px">🖨製造</a></td>'; return; }
        if (k.seizo) { var sp = 製造指示書状態(row['伝票番号']); var 受注 = String(row['案件区分'] || '') === '受注' || !row['案件区分'];
          t += '<td onclick="event.stopPropagation()" style="white-space:nowrap;font-size:11px">' + (sp ? ('<a href="sagyo.html?no=' + encodeURIComponent(String(row['伝票番号'] || '')) + '&type=seizo" target="_blank" rel="noopener" style="color:#166534;font-weight:700" title="' + esc(sp.comment || '') + '">第' + sp.n + '回 ' + esc(String(sp.at || '').slice(0, 10).replace(/-/g, '/')) + '</a>')
            : (受注 ? '<a href="sagyo.html?no=' + encodeURIComponent(String(row['伝票番号'] || '')) + '&type=seizo" target="_blank" rel="noopener" style="color:#b91c1c;font-weight:700;background:#fee2e2;border-radius:4px;padding:1px 6px" title="製造指示書がまだ出ていません。押すと出せます">未出力</a>' : '<span style="color:#94a3b8">—</span>')) + '</td>'; return; }
        if (k.dtp) { var st = window.DTP状態 ? DTP状態(row['伝票番号']) : ''; var on = !!st;
          t += '<td onclick="event.stopPropagation()" style="white-space:nowrap"><select class="dtp-sel" data-no="' + esc(row['伝票番号'] || '') + '" title="有にすると校正BOXにカードができます" style="font:inherit;font-size:11px;padding:1px 2px;' + (on ? 'background:#ede9fe;color:#5b21b6;font-weight:700' : '') + '"><option value=""' + (on ? '' : ' selected') + '>無</option><option value="有"' + (on ? ' selected' : '') + '>有</option></select>'
             + (st === 'card' ? '<span title="校正BOXにカードがあります" style="font-size:11px;margin-left:3px">📸</span>' : st ? '<span title="送信済み（本体を開くとカードになります）" style="font-size:11px;margin-left:3px;color:#a78bfa">⏳</span>' : '') + '</td>'; return; }
        if (k.badge) { var cls = STAGE_CLASS[v] || ''; t += '<td>' + (v ? '<span class="badge ' + cls + '">' + esc(v) + '</span>' : '') + '</td>'; }
        else if (k.date) { t += '<td>' + esc(日付(v)) + '</td>'; }
        else if (k.money || k.num) { t += '<td class="num">' + esc(円(v)) + '</td>'; }
        else { t += '<td>' + esc(v == null ? '' : v) + '</td>'; }
      });
      return t + '</tr>';
    }
    r.行.slice(0, 描いた).forEach(function (row) { h += 行の札(row); });
    if (false) r.行.forEach(function (row) {
      h += '<tr class="r" data-id="' + esc(row.recordId) + '">';
      h += '<td onclick="event.stopPropagation()"><input type="checkbox" class="pick" data-id="' + esc(row.recordId) + '"></td>';
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
    if (r.行.length > 描いた) h += '<div style="padding:6px"><button id="ff-more" style="padding:4px 12px">続きを出す（残り ' + (r.行.length - 描いた).toLocaleString() + ' 件）</button></div>';
    box.innerHTML = h;
    box.style.display = 'block';
    var 行を結ぶ;   // 行クリックの付け直し（下で定義）
    var moreBtn = $('ff-more');
    if (moreBtn) moreBtn.onclick = function () {
      var 次 = r.行.slice(描いた, 描いた + 一度に); 描いた += 次.length;
      var tb = box.querySelector('tbody'); var frag = document.createElement('tbody'); frag.innerHTML = 次.map(行の札).join('');
      Array.prototype.forEach.call(Array.prototype.slice.call(frag.children), function (tr) { tb.appendChild(tr); 行を結ぶ(tr); });
      if (描いた >= r.行.length) moreBtn.parentNode.remove(); else moreBtn.textContent = '続きを出す（残り ' + (r.行.length - 描いた).toLocaleString() + ' 件）';
    };
    $('ff-msg').textContent = r.件数 + ' 件'
      + (r.全体 && r.全体 > r.件数 ? '（あてはまる ' + r.全体.toLocaleString() + ' 件のうち）' : '')
      + (r.日数 ? '　起票日 直近' + r.日数 + '日' : '')
      + '　' + (r.源 === '索引' ? r.ミリ秒 + 'ms（手元の索引）' : (r.ミリ秒 / 1000).toFixed(1) + '秒') + '　「表示」かダブルクリックで開きます（1 回クリックはチェック）';

    // KOSEI-GROUP-1: チェックした伝票を 1 枚の校正にまとめる
    $('ff-proof-group').onclick = function () {
      var ids = Array.prototype.map.call(box.querySelectorAll('input.pick:checked'), function (x) { return x.getAttribute('data-id'); });
      var rows = (r.行 || []).filter(function (x) { return ids.indexOf(String(x.recordId)) >= 0; });
      if (rows.length < 2) { alert('まとめる伝票を左のチェックで 2 件以上選んでください'); return; }
      var nos = rows.map(function (x) { return String(x['伝票番号'] || ''); }).filter(Boolean);
      var custs = {}; rows.forEach(function (x) { custs[String(x['得意先コード'] || '')] = 1; });
      var 文 = nos.length + ' 件を 1 つの校正としてまとめて校正BOXへ送ります。\n\n' + rows.map(function (x) { return x['伝票番号'] + ' ' + (x['製品名'] || ''); }).join('\n') + (Object.keys(custs).length > 1 ? '\n\n⚠ 得意先が違う伝票が混ざっています' : '') + '\n\nよろしいですか？';
      if (!confirm(文)) return;
      var msg = DTP送信(rows[0], '有', '', nos, rows.map(function (x) { return { 伝票番号: String(x['伝票番号'] || ''), 製品名: String(x['製品名'] || '') }; }));
      $('ff-msg').textContent = nos.join('・') + ' をまとめて ' + msg;
      Array.prototype.forEach.call(box.querySelectorAll('select.dtp-sel'), function (s) { if (nos.indexOf(s.getAttribute('data-no')) >= 0) { s.value = '有'; s.style.background = '#ede9fe'; s.style.color = '#5b21b6'; s.style.fontWeight = '700'; var mk = s.parentNode.querySelector('span'); if (mk) mk.remove(); s.insertAdjacentHTML('afterend', '<span title="まとめた校正として送信済み（本体を開くとカードになります）" style="font-size:11px;margin-left:3px;color:#a78bfa">📎⏳</span>'); } });
    };
    $('ff-group').onclick = function () {
      var ids = Array.prototype.map.call(box.querySelectorAll('input.pick:checked'), function (x) { return x.getAttribute('data-id'); });
      if (ids.length < 1) { alert('まとめる伝票を左のチェックで選んでください（1 件でも可＝案件IDを入れ直す）'); return; }
      var 指定 = $('ff-group-id').value.trim();
      $('ff-msg').textContent = '案を作っています…';
      呼ぶ('画面_案件にまとめる', [ids, 指定, 1]).then(function (a) {
        var 文 = '案件ID「' + a.案件ID + '」でまとめます。\n\n' + a.案.map(function (x) { return (x.変える ? '変更 ' : '同じ ') + x.区分 + ' ' + x.番号 + '（' + (x.今 || '案件IDなし') + '）'; }).join('\n') + '\n\nFileMaker に書き込みます。よろしいですか？';
        if (!confirm(文)) { $('ff-msg').textContent = 'やめました'; return; }
        return 呼ぶ('画面_案件にまとめる', [ids, a.案件ID, 0]).then(function (r) {
          // 手元の索引にも反映
          if (索引) { var P = 索引位置; for (var i = 0; i < 索引.行.length; i++) { if (ids.indexOf(String(索引.行[i][P['recordId']])) >= 0) 索引.行[i][P['案件ID']] = r.案件ID; } }
          $('ff-msg').textContent = '案件 ' + r.案件ID + ' にまとめました（' + r.更新 + ' 件を更新）';
          if (現在 && ids.indexOf(String(現在.recordId)) >= 0) { 現在.fields['案件ID'] = r.案件ID; 札を出す(現在); 履歴を出す(r.履歴); }
          手元で探す(false);
        });
      }).catch(function (e) { $('ff-msg').textContent = String(e.message || e); });
    };
    function 行を開く(id) {
      if (Object.keys(変更分()).length
          && !confirm('保存していない編集があります。捨てて開きますか？')) return;
      待機(true); 状態('開いています…');
      呼ぶ('画面_recordIdで読む', [id])
        .then(function (x) { 受け取る(x, '開きました'); 結果を畳む(); })
        .catch(function (e) { 状態(String(e.message || e), 'err'); 待機(false); });
    }
    行を結ぶ = function (tr) {
      var id = tr.getAttribute('data-id');
      // 1 回クリック＝チェックを付け外し、ダブルクリック＝開く、「表示」ボタン＝開く
      tr.onclick = function (ev) { if (ev.target && (ev.target.tagName === 'INPUT' || ev.target.tagName === 'BUTTON')) return; var ck = tr.querySelector('input.pick'); if (ck) ck.checked = !ck.checked; };
      tr.ondblclick = function (ev) { if (ev.target && ev.target.tagName === 'INPUT') return; var ck = tr.querySelector('input.pick'); if (ck) ck.checked = !ck.checked; 行を開く(id); };
      var ob = tr.querySelector('button.open'); if (ob) ob.onclick = function (ev) { ev.stopPropagation(); 行を開く(id); };
      // KOSEI-DTP-1: 一覧の DTP 列。有にした瞬間に校正BOXへ（内容は本体のカードで入れる）
      var ds = tr.querySelector('select.dtp-sel'); if (ds) ds.onchange = function (ev) { ev.stopPropagation();
        var row = (r.行 || []).filter(function (x) { return String(x.recordId) === String(id); })[0] || {};
        var msg = DTP送信(row, ds.value, ''); $('ff-msg').textContent = (row['伝票番号'] || '') + ' ' + msg;
        ds.style.background = ds.value === '有' ? '#ede9fe' : ''; ds.style.color = ds.value === '有' ? '#5b21b6' : ''; ds.style.fontWeight = ds.value === '有' ? '700' : '';
        var mark = ds.parentNode.querySelector('span'); if (mark) mark.remove(); if (ds.value === '有') ds.insertAdjacentHTML('afterend', '<span title="送信済み（本体を開くとカードになります）" style="font-size:11px;margin-left:3px;color:#a78bfa">⏳</span>');
        if (現在 && String(現在.fields['伝票番号'] || '') === String(row['伝票番号'] || '')) DTPを出す(String(row['伝票番号'] || ''));
      };
    };
    Array.prototype.forEach.call(box.querySelectorAll('tr.r'), 行を結ぶ);
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
  // 日付の文字（MM/DD/YYYY か YYYY-MM-DD）→ yyyymmdd の数。読めなければ 0
  function 日を数に(s) { s = String(s || '').trim(); if (!s) return 0; var m = /^(\d\d)\/(\d\d)\/(\d{4})$/.exec(s); if (m) return Number(m[3] + m[1] + m[2]); m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(s); return m ? Number(m[1] + m[2] + m[3]) : 0; }
  // 得意先の名前（一部でよい）→ 当てはまる得意先コードの集合。マスタが手元に無ければ null
  function 得意先コードを名前で(nm) {
    var m = 得意先マスタ; if (!m) { try { var c = JSON.parse(localStorage.getItem('fm_master_得意先マスタ') || 'null'); if (c && c.行) { 得意先マスタ = c; m = c; } } catch (e) {} }
    if (!m) return null;
    var key = String(nm).toLowerCase(), out = {}, n = 0;
    m.行.forEach(function (r) { if (String(r['得意先名'] || '').toLowerCase().indexOf(key) >= 0) { out[String(r['得意先コード'])] = 1; n++; } });
    return out;
  }
  function 索引を据える(j) {
    索引 = j; 索引位置 = {}; j.列.forEach(function (c, i) { 索引位置[c] = i; });
    var d = 索引位置['起票日'];
    索引日 = j.行.map(function (r) { var m = /^(\d\d)\/(\d\d)\/(\d{4})$/.exec(String(r[d] || '')); return m ? Number(m[3] + m[1] + m[2]) : 0; });
    try { setTimeout(案件管理表として出す, 0); } catch (e) {}
  }
  var 索引待ち = 0;
  function 索引を用意() {
    var 有効 = 24 * 60 * 60 * 1000;
    return 索引を開くDB().then(function (db) {
      return new Promise(function (res) {
        var r = db.transaction('idx').objectStore('idx').get('juchu');
        r.onsuccess = function () { res(r.result || null); }; r.onerror = function () { res(null); };
      }).then(function (o) {
        if (o && o.行) { 索引を据える(o); 索引の状態(); }
        var 古い = !o || !o.取った || (Date.now() - new Date(o.取った).getTime()) > 有効 || (o.列 && o.列.indexOf('案件ID') < 0);   // 列が増えたら取り直す
        if (!古い) return 索引の差分を重ねる();
        if (!(window.FM名乗っている ? FM名乗っている() : true)) {   // サインイン前なら、サインインを待ってもう一度（最大 20 回・1 分）
          索引待ち = (索引待ち || 0) + 1; if (索引待ち <= 20) setTimeout(索引を用意, 3000); return;
        }
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
    var 日数 = Number($('ff-days').value), 件数 = Number($('ff-n').value || 0);   // 0 = すべて
    var user = $('ff-user').value.trim().toLowerCase(), tanto = $('ff-tanto').value.trim(), hinshu = $('ff-hinshu').value.trim().toLowerCase();
    var 未出力だけ = !!($('ff-seizo') && $('ff-seizo').checked);   // SEIZO-1
    var d1 = 日を数に($('ff-d1').value), d2 = 日を数に($('ff-d2').value), n1 = 日を数に($('ff-n1').value), n2 = 日を数に($('ff-n2').value);
    // FMHUB-FIND-ALL: 何でも検索（空白区切りの語を全部含む）。得意先名で当てるためにマスタが要る
    var all = $('ff-all') ? $('ff-all').value.trim().normalize('NFKC').toLowerCase().split(/[\s　]+/).filter(Boolean) : [];
    var 名前表 = null;
    if (all.length) {
      if (!得意先マスタ) { try { var cm = JSON.parse(localStorage.getItem('fm_master_得意先マスタ') || 'null'); if (cm && cm.行) 得意先マスタ = cm; } catch (e) {} }
      if (!得意先マスタ) { $('ff-msg').textContent = '得意先マスタを読んでいます…'; 得意先マスタを用意().then(function () { 手元で探す(false); }); return true; }
      名前表 = {}; 得意先マスタ.行.forEach(function (r) { 名前表[String(r['得意先コード'])] = String(r['得意先名'] || '').normalize('NFKC').toLowerCase(); });
    }
    // 得意先: 数字ならコード、それ以外は得意先マスタの名前で前方一致→該当コードの集合
    var custSet = null;
    if (cust && !/^\d+$/.test(cust)) { custSet = 得意先コードを名前で(cust); if (!custSet) { $('ff-msg').textContent = '得意先マスタを読んでいます…'; 得意先マスタを用意().then(function () { 手元で探す(false); }); return true; } }
    var 番号らしい = /^[a-zA-Z]?\d{2,}$/.test(kw);
    if (番号らしい) 日数 = 0;
    if (all.length) 日数 = 0;   // 何でも検索は全期間
    if (d1 || d2) 日数 = 0;   // 日付を指定したら「期間」は使わない
    try { var 条件 = {}; ['ff-all', 'ff-kw', 'ff-cust', 'ff-user', 'ff-tanto', 'ff-hinshu', 'ff-d1', 'ff-d2', 'ff-n1', 'ff-n2', 'ff-stage', 'ff-days', 'ff-n'].forEach(function (id) { if ($(id)) 条件[id] = $(id).value; }); 条件.全件 = 全件モード; sessionStorage.setItem('fm_find', JSON.stringify(条件)); } catch (e) {}
    if (!all.length && !kw && !cust && !段階 && !user && !tanto && !hinshu && !d1 && !d2 && !n1 && !n2 && !全件モード && !未出力だけ) { $('ff-rows').style.display = 'none'; 索引の状態(); return true; }
    全件モード = false;
    var から = 0;
    if (日数 > 0) { var d = new Date(); d.setDate(d.getDate() - 日数); から = Number(d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0')); }
    var P = 索引位置, 行 = 索引.行, kwl = kw.toLowerCase(), hits = [], t0 = Date.now();
    for (var i = 0; i < 行.length; i++) {
      var r = 行[i];
      if (から && 索引日[i] < から) continue;
      if (d1 && 索引日[i] < d1) continue; if (d2 && 索引日[i] > d2) continue;
      if (n1 || n2) { var nd = 日を数に(r[P['納品日']]); if (!nd) continue; if (n1 && nd < n1) continue; if (n2 && nd > n2) continue; }
      if (custSet) { if (!custSet[String(r[P['得意先コード']])]) continue; } else if (cust && String(r[P['得意先コード']]) !== cust) continue;
      if (段階 && String(r[P['案件区分']]) !== 段階) continue;
      if (未出力だけ) { var kb = String(r[P['案件区分']] || ''); if (kb && kb !== '受注') continue; if (製造指示書状態(r[P['伝票番号']])) continue; }
      if (user && String(r[P['ユーザー名']]).toLowerCase().indexOf(user) < 0) continue;
      if (tanto && String(r[P['担当者コード']]) !== tanto) continue;
      if (hinshu && String(r[P['品種']]).toLowerCase().indexOf(hinshu) < 0) continue;
      if (kw) {
        if (番号らしい) { if (String(r[P['伝票番号']]).toLowerCase().indexOf(kwl) !== 0 && String(r[P['案件ID']] || '').toLowerCase().indexOf(kwl) !== 0 && String(r[P['見積番号']] || '').toLowerCase().indexOf(kwl) !== 0) continue; }
        else if (String(r[P['製品名']]).toLowerCase().indexOf(kwl) < 0 && String(r[P['ユーザー名']]).toLowerCase().indexOf(kwl) < 0) continue;
      }
      if (all.length) {   // FMHUB-FIND-ALL: 全項目をつないだ 1 本の文字列に、語が全部含まれるか
        var code = String(r[P['得意先コード']] || '');
        var 束 = [r[P['伝票番号']], r[P['見積番号']], r[P['案件ID']], code, 名前表[code] || '', r[P['ユーザー名']], r[P['製品名']], r[P['品種']], r[P['担当者コード']]]
          .map(function (v) { return String(v == null ? '' : v); }).join('\n').normalize('NFKC').toLowerCase();
        var ok = true; for (var a = 0; a < all.length; a++) { if (束.indexOf(all[a]) < 0) { ok = false; break; } }
        if (!ok) continue;
      }
      hits.push(i);
    }
    var 全体 = hits.length;
    if (番号らしい) hits.sort(function (a, b) { return String(行[a][P['伝票番号']]) < String(行[b][P['伝票番号']]) ? -1 : 1; });
    else hits.sort(function (a, b) { return (索引日[b] - 索引日[a]) || (Number(行[b][P['recordId']]) - Number(行[a][P['recordId']])); });
    if (件数 > 0) hits = hits.slice(0, 件数);
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
    var all = $('ff-all') ? $('ff-all').value.trim() : '';
    if (all && !kw) { kw = all; $('ff-days').value = '0'; }   // FMHUB-FIND-ALL: 索引が無いときは中継に全期間で聞く（製品名・ユーザー名）
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
  ['ff-all', 'ff-kw', 'ff-cust', 'ff-user', 'ff-tanto', 'ff-hinshu'].forEach(function (id) {
    if (!$(id)) return;
    $(id).addEventListener('keydown', function (e) { if (e.key === 'Enter') 探す(); });
    $(id).addEventListener('input', 打ちながら);
  });
  ['ff-stage', 'ff-days', 'ff-n', 'ff-d1', 'ff-d2', 'ff-n1', 'ff-n2', 'ff-seizo'].forEach(function (id) { if ($(id)) $(id).addEventListener('change', function () { 手元で探す(false); }); });
  探し.addEventListener('keydown', function (e) { if (e.key !== 'Enter') return; var t = e.target; if (!t || !(t.tagName === 'INPUT' || t.tagName === 'SELECT')) return; if (t.closest('#ff-rows')) return; e.preventDefault(); 探す(); });
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
    var 見出し = (モード === 'mitsu' ? '見積入力' : モード === 'ichiran' ? '案件管理表（FileMaker）' : '受注入力');
    var 名札 = document.querySelector('.hdrow .ttl'); if (名札) 名札.textContent = 見出し;
    document.title = 見出し + ' | Tokiwa Hub';
  }
  // 案件管理表モード: 開いたら探す窓を出して、直近 3 か月・200 件を新しい順に（索引が来たら自動で）
  var 一覧を出した = false;
  function 案件管理表として出す() {
    if (モード !== 'ichiran' || 一覧を出した || !索引) return;
    一覧を出した = true;
    探し.style.display = 'block';
    $('ff-days').value = '90'; $('ff-n').value = '0'; 全件モード = true;
    var 自社 = 自社の得意先コード();   // 関連会社のアカウントなら、その会社が得意先の伝票だけ（トキワは全部）
    if (自社) { $('ff-cust').value = 自社; $('ff-msg').textContent = 会社名() + '（得意先 ' + 自社 + '）の伝票だけを出しています'; }
    手元で探す(false);
  }
  // 見積入力では「予算見積」か「見積書」かを選んで起こす。番号（-YM01／-M01）と区分は中継が付ける
  function 種別を選んで起こす() {
    var old = document.getElementById('fm-kind-pick'); if (old) old.remove();
    var m = document.createElement('div'); m.id = 'fm-kind-pick';
    m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:200;display:flex;align-items:center;justify-content:center';
    var 案件 = 現在 && 現在.fields['案件ID'] ? ('案件 ' + 現在.fields['案件ID'] + ' の続きとして') : 'まっさらな案件として';
    m.innerHTML = '<div style="background:#fff;border-radius:10px;padding:16px 18px;width:min(460px,94vw);font-size:13px">'
      + '<div style="font-weight:700;font-size:14px;margin-bottom:6px">何を起こしますか？</div>'
      + '<div style="color:#475569;margin-bottom:12px">' + 案件 + '起こします。番号と区分は FileMaker 側で付きます。</div>'
      + '<div style="display:flex;gap:10px;flex-wrap:wrap">'
      + '<button data-kind="予算見積" style="flex:1;padding:12px;font:inherit;font-weight:700;border:2px solid #b45309;background:#fffbeb;color:#92400e;border-radius:8px;cursor:pointer">予算見積<br><span style="font-weight:400;font-size:11px">番号 aNNNNNN-YM01（概算・予算どり）</span></button>'
      + '<button data-kind="見積" style="flex:1;padding:12px;font:inherit;font-weight:700;border:2px solid #1d4ed8;background:#eff6ff;color:#1e3a8a;border-radius:8px;cursor:pointer">見積書<br><span style="font-weight:400;font-size:11px">番号 aNNNNNN-M01（提出する見積）</span></button>'
      + '</div><div style="text-align:right;margin-top:10px"><button id="fm-kind-x" style="font:inherit;padding:5px 12px;border:1px solid #cbd5e1;background:#fff;border-radius:6px;cursor:pointer">やめる</button></div></div>';
    document.body.appendChild(m);
    m.querySelector('#fm-kind-x').onclick = function () { m.remove(); 起こした後 = null; };
    Array.prototype.forEach.call(m.querySelectorAll('button[data-kind]'), function (x) { x.onclick = function () { var kind = x.getAttribute('data-kind'); m.remove(); var n = document.querySelector('#fmbar button.new[data-kind="' + kind + '"]'); if (n) n.click(); }; });
  }
  // 緑の帯にも「保存」を置く（黒帯の保存は画面を下にスクロールすると見えなくなるため）
  (function () {
    var 新規 = 帯のボタン('新規作成'); if (!新規 || !新規.parentNode) return;
    var b = document.createElement('button'); b.className = 'fb'; b.id = 'fb-save'; b.textContent = '💾 保存';
    b.style.cssText = 'background:#1d6f3f;color:#fff;border-color:#1d6f3f';
    b.title = '打った内容を FileMaker に保存します（伝票を読み込んでいなければ新しく起こしてから保存）';
    b.onclick = function () { 保存(); };
    新規.parentNode.insertBefore(b, 新規);
  })();
  帯に付ける('新規作成', function () {
    if (モード === 'mitsu') { 種別を選んで起こす(); return; }
    var n = document.querySelector('#fmbar button.new[data-kind="' + 起こす種別 + '"]') || document.querySelector('#fmbar button.new');
    if (n) n.click();
  }, モード === 'mitsu' ? '予算見積か見積書かを選んで、FileMaker に新しく起こします（番号は自動）' : 'FileMaker に新しい' + 起こす種別 + 'を起こします（黒帯の「' + 起こす種別 + '」と同じ）');
  帯に付ける('検索モード', function () { 探し.style.display = 'block'; $('ff-kw').focus(); $('ff-kw').select(); }, '探す窓に移ります。打つと出ます');
  帯に付ける('全体表示', function () {
    探し.style.display = 'block';
    $('ff-kw').value = ''; $('ff-cust').value = ''; $('ff-stage').value = ''; $('ff-days').value = '0'; $('ff-n').value = '0';
    ['ff-user', 'ff-tanto', 'ff-hinshu', 'ff-d1', 'ff-d2', 'ff-n1', 'ff-n2'].forEach(function (id) { $(id).value = ''; });
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
  帯に付ける('配送カレンダー', function () { window.open('haiso-calendar.html', '_blank'); }, '配送カレンダー（FileMaker と同じ。予定テーブルを読み書き）');
  帯に付ける('外注入力', function () { location.href = '../index.html?page=outsource'; }, 'Hub の外注発注へ');
  // 作業指示書（FileMaker と同じ紙を Hub で出す）: 帯の「レイアウト編集」の前に足す
  (function () {
    var lay = 帯のボタン('レイアウト編集'); if (!lay || 帯のボタン('外注指示書')) return;
    // SAGYO-2: 外注指示書（FileMaker と同じ紙）と 製造指示書（内製用）を分けて出す
    var b2 = document.createElement('button'); b2.className = 'fb or'; b2.textContent = '外注指示書'; b2.title = '読み込んでいる伝票の外注指示書（FileMaker の作業指示書と同じ形）を出します';
    b2.onclick = function () { 読んでから(function () { window.open('sagyo.html?no=' + encodeURIComponent(String(現在.fields['伝票番号'] || '')), '_blank'); }); };
    lay.parentNode.insertBefore(b2, lay);
    var b3 = document.createElement('button'); b3.className = 'fb or'; b3.textContent = '製造指示書'; b3.title = '読み込んでいる伝票の製造指示書（内製用: 用紙→印刷→加工→製本・梱包→納品の順、工程チェック欄つき）を出します';
    b3.onclick = function () { 読んでから(function () { window.open('sagyo.html?no=' + encodeURIComponent(String(現在.fields['伝票番号'] || '')) + '&type=seizo', '_blank'); }); };
    lay.parentNode.insertBefore(b3, lay);
  })();
  帯に付ける('受注一覧', function () { 探し.style.display = 'block'; $('ff-days').value = '0'; $('ff-n').value = '0'; 全件モード = true; if (!手元で探す(false)) 探す(); }, '探す窓に新しい順で出します');

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
  // 開いた直後の各欄の値（既定値）。空の画面から保存するとき、既定値のままの欄は「打った内容」に数えない
  var 画面の初期値 = {}; Object.keys(TO_FM).forEach(function (id) { var el = document.getElementById(id); if (el) 画面の初期値[id] = el.value; });
  btnS.onclick = 保存; btnS.disabled = false;   // 空の画面からでも押せる（起こしてから保存）
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
  // 開き直したとき（指示書から戻る・F5）は、さっきの伝票と探す条件に戻す
  var 復元 = null; try { 復元 = JSON.parse(sessionStorage.getItem('fm_find') || 'null'); } catch (e) {}
  if (!q) { try { q = sessionStorage.getItem('fm_last_no') || ''; } catch (e) {} }
  if (q) { 番号欄.value = q; 読み込む(q); }
  if (復元 && モード !== 'ichiran') {
    var 何か = false; Object.keys(復元).forEach(function (id) { if (id === '全件') return; var el = $(id); if (el && 復元[id] != null && String(復元[id]) !== '') { el.value = 復元[id]; if (['ff-days', 'ff-n', 'ff-stage'].indexOf(id) < 0) 何か = true; } });
    if (何か || 復元.全件) { 探し.style.display = 'block'; 全件モード = !!復元.全件; var 試す = 0; var t = setInterval(function () { 試す++; if (索引) { clearInterval(t); 手元で探す(false); if (q) 結果を畳む(); } else if (試す > 40) clearInterval(t); }, 500); }
  }

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
