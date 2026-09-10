# -*- coding: utf-8 -*-
"""受注入力（tools/fm-juchu.html）を、GAS から配信する版に組み立てる。

   元の画面には手を入れず、末尾に「FileMaker とつなぐ」ぶんの
   ツールバーと処理を足すだけにする。元を直したらこれを流し直せばよい。

     python tools/fm-relay/build_juchu.py
       → tools/fm-relay/juchu.html
"""
import os, re, sys, io

if hasattr(sys.stdout, 'buffer'):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8',
                                  errors='replace', line_buffering=True)

HERE = os.path.dirname(os.path.abspath(__file__))
SRC  = os.path.join(HERE, '..', 'fm-juchu.html')
DST  = os.path.join(HERE, 'juchu.html')

ADDON = r'''
<!-- ==================================================================
     ここから下は build_juchu.py が足したぶん。
     受注入力を FileMaker の実データにつなぐ。元の画面はいじっていない。
     ================================================================== -->
<style>
  #fmbar{ position:sticky; top:0; z-index:60; display:flex; gap:8px; align-items:center;
          flex-wrap:wrap; padding:7px 12px; background:#1a1a1a; color:#fff;
          font-size:13px; border-bottom:2px solid #000; }
  #fmbar input{ font:inherit; padding:4px 8px; border:1px solid #555; border-radius:4px;
                background:#fff; color:#1a1a1a; width:130px; }
  #fmbar button{ font:inherit; padding:5px 14px; border-radius:5px; cursor:pointer;
                 border:1px solid #555; background:#333; color:#fff; }
  #fmbar button.go{ background:#fff; color:#1a1a1a; font-weight:700; border-color:#fff; }
  #fmbar button.save{ background:#1d6f3f; border-color:#1d6f3f; font-weight:700; }
  #fmbar button:disabled{ opacity:.45; cursor:default; }
  #fmstat{ margin-left:auto; font-size:12px; color:#cbd5e1; text-align:right; }
  #fmstat.err{ color:#ffb4ac; font-weight:700; }
  #fmstat.ok{ color:#9ae6b4; }
  #fmwarn{ background:#7a2018; color:#fff; padding:6px 12px; font-size:12.5px; display:none; }
  .fm-dirty{ outline:2px solid #d97706 !important; outline-offset:-2px; }
</style>

<div id="fmbar">
  <b>FileMaker</b>
  <input id="fm-denpyo" placeholder="伝票番号" autocomplete="off">
  <button class="go" id="fm-load">読み込む</button>
  <button class="save" id="fm-save" disabled>保存</button>
  <button id="fm-reload" disabled title="編集を捨てて FileMaker の内容に戻す">読み直す</button>
  <span id="fmstat">伝票番号を入れて「読み込む」</span>
</div>
<div id="fmwarn"></div>

<script>
(function () {
  'use strict';

  // 画面の項目id → FileMaker の列名（FMUSE から作る。列が無いものは除く）
  var TO_FM = {}, FROM_FM = {};
  Object.keys(FMUSE).forEach(function (id) {
    var col = FMUSE[id].c;
    if (!col || col.indexOf('FMに') === 0 || col.indexOf('FMは') === 0) return;
    TO_FM[id] = col;
    (FROM_FM[col] = FROM_FM[col] || []).push(id);
  });

  var 現在 = null;      // { recordId, modId, fields }  いま画面に出ている伝票
  var 読込時 = {};      // 画面の項目id → 読み込んだ直後の値。保存時の差分に使う
  var 書ける = null;    // FileMaker 側で書ける列名

  var bar    = document.getElementById('fmbar');
  var 番号欄 = document.getElementById('fm-denpyo');
  var stat   = document.getElementById('fmstat');
  var warn   = document.getElementById('fmwarn');
  var btnL   = document.getElementById('fm-load');
  var btnS   = document.getElementById('fm-save');
  var btnR   = document.getElementById('fm-reload');

  function 状態(msg, kind) {
    stat.textContent = msg;
    stat.className = kind || '';
  }
  function 警告(msg) {
    warn.textContent = msg || '';
    warn.style.display = msg ? 'block' : 'none';
  }
  function 待機(on) {
    btnL.disabled = on;
    btnS.disabled = on || !現在;
    btnR.disabled = on || !現在;
  }

  /** google.script.run を Promise で使う */
  function 呼ぶ(name, args) {
    return new Promise(function (ok, ng) {
      google.script.run
        .withSuccessHandler(function (r) {
          if (r && r.ok === false) ng(new Error(r.error || '不明なエラー'));
          else ok(r);
        })
        .withFailureHandler(function (e) { ng(e); })
        [name].apply(null, args || []);
    });
  }

  // -------------------------------------------------- 読み込み

  function 流し込む(rec) {
    現在 = rec;
    読込時 = {};
    Object.keys(TO_FM).forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      var v = rec.fields[TO_FM[id]];
      v = (v === undefined || v === null) ? '' : String(v);
      s(id, v);
      読込時[id] = v;
      el.classList.remove('fm-dirty');
    });
    try { calc(); } catch (e) {}
    try { onInk(); } catch (e) {}
    try { applyRowVis(); } catch (e) {}
  }

  function 読み込む(denpyo) {
    denpyo = (denpyo || 番号欄.value || '').trim();
    if (!denpyo) { 状態('伝票番号を入れてください', 'err'); return; }
    待機(true); 警告(''); 状態('読み込み中… ' + denpyo);
    var t0 = Date.now();
    呼ぶ('画面_読み込み', [denpyo]).then(function (r) {
      if (!r.record) { 現在 = null; 状態('伝票 ' + denpyo + ' は見つかりません', 'err'); 待機(false); return; }
      書ける = r.writable;
      流し込む(r.record);
      番号欄.value = denpyo;
      状態(denpyo + ' を読み込みました（' + (Date.now() - t0) + 'ms・' + r.user + '）', 'ok');
      待機(false);
    }).catch(function (e) {
      現在 = null; 状態(String(e.message || e), 'err'); 待機(false);
    });
  }

  // -------------------------------------------------- 保存

  /** 読み込んだときから変わった項目だけを集める */
  function 変更分() {
    var out = {}, 見た = {};
    Object.keys(TO_FM).forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      var now = String(el.value == null ? '' : el.value).trim();
      if (now === (読込時[id] || '')) return;
      var col = TO_FM[id];
      if (書ける && 書ける.indexOf(col) < 0) return;   // 計算などは送らない
      // 同じ列を指す欄が2つある場合は、変わっている方を採る
      if (見た[col] !== undefined && 見た[col] !== now) {
        console.warn('同じ列に別々の値: ' + col, 見た[col], now);
      }
      見た[col] = now;
      out[col] = now;
    });
    return out;
  }

  function 保存() {
    if (!現在) return;
    var 差分 = 変更分();
    var n = Object.keys(差分).length;
    if (!n) { 状態('変更はありません', ''); return; }
    if (!confirm(n + ' 項目を FileMaker に保存します。よろしいですか？\n\n'
                 + Object.keys(差分).slice(0, 30).join('、')
                 + (n > 30 ? ' …ほか' + (n - 30) + '件' : ''))) return;

    待機(true); 警告(''); 状態('保存中… ' + n + ' 項目');
    呼ぶ('画面_保存', [現在.recordId, 現在.modId, 差分]).then(function (r) {
      if (r.conflict) {
        警告(r.message);
        状態('保存できませんでした', 'err');
        待機(false);
        return;
      }
      流し込む({ recordId: r.recordId, modId: r.modId, fields: r.fields });
      状態(r.saved.length + ' 項目を保存しました（金額は再計算済み）', 'ok');
      待機(false);
    }).catch(function (e) {
      状態(String(e.message || e), 'err'); 待機(false);
    });
  }

  // -------------------------------------------------- 画面まわり

  // 変わった欄に色を付ける
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
    if (Object.keys(変更分()).length && !confirm('編集を捨てて FileMaker の内容に戻します。よろしいですか？')) return;
    読み込む(現在 ? 現在.fields['伝票番号'] : '');
  };
  番号欄.addEventListener('keydown', function (e) { if (e.key === 'Enter') 読み込む(); });

  // 画面をいちばん上に置く
  document.body.insertBefore(warn, document.body.firstChild);
  document.body.insertBefore(bar, document.body.firstChild);

  番号欄.focus();
})();
</script>
'''


def main():
    src = open(SRC, encoding='utf-8').read()
    if '</body>' not in src:
        print('× </body> が見つかりません'); return 1

    out = src.replace('</body>', ADDON + '\n</body>', 1)

    # GAS の HtmlService はテンプレート記法 <?= ?> を解釈してしまうので確認だけしておく
    for bad in ('<?=', '<?!'):
        if bad in out:
            print('△ テンプレート記法 %s が含まれています。表示が崩れるかもしれません' % bad)

    open(DST, 'w', encoding='utf-8').write(out)
    print('組み立てました: %s  (%.0f KB)' % (DST, len(out.encode('utf-8')) / 1024))
    print('  元: %s' % os.path.normpath(SRC))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
