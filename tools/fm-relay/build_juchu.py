# -*- coding: utf-8 -*-
"""受注入力（tools/fm-juchu.html）を、GAS から配信する版に組み立てる。

   元の画面には手を入れず、末尾に「FileMaker とつなぐ」ぶんの
   ツールバーと処理を足すだけにする。元を直したらこれを流し直せばよい。

     python tools/fm-relay/build_juchu.py
       → tools/fm-relay/juchu.html
"""
import os, sys, io

if hasattr(sys.stdout, 'buffer'):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8',
                                  errors='replace', line_buffering=True)

HERE = os.path.dirname(os.path.abspath(__file__))
SRC  = os.path.join(HERE, '..', 'fm-juchu.html')
DST  = os.path.join(HERE, 'juchu.html')

ADDON = r"""
<!-- ==================================================================
     ここから下は build_juchu.py が足したぶん。
     受注入力を FileMaker の実データにつなぎ、段階（予算見積/見積/受注）を扱う。
     元の画面（tools/fm-juchu.html）はいじっていない。
     ================================================================== -->
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
  #fmbar .sep{ width:1px; height:20px; background:#555; margin:0 3px; }
  #fmstage{ font-weight:700; padding:2px 9px; border-radius:11px; background:#475569; }
  #fmstage.yosan{ background:#7c5a18; }
  #fmstage.mitsu{ background:#1e4d8c; }
  #fmstage.juchu{ background:#1d6f3f; }
  #fmstage.shitchu{ background:#6b2320; }
  #fmstat{ margin-left:auto; font-size:12px; color:#cbd5e1; text-align:right; max-width:38%; }
  #fmstat.err{ color:#ffb4ac; font-weight:700; }
  #fmstat.ok{ color:#9ae6b4; }
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
  .fm-dirty{ outline:2px solid #d97706 !important; outline-offset:-2px; }
</style>

<div id="fmbar">
  <b>FileMaker</b>
  <input id="fm-no" placeholder="伝票番号・見積番号" autocomplete="off">
  <button class="go" id="fm-load">読み込む</button>
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
  <span id="fmstat">番号を入れて「読み込む」／何も読み込まずに「新しく起こす」と新規案件</span>
</div>
<div id="fmdiff"></div>
<div id="fmerr"></div>

<script>
(function () {
  'use strict';

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
  var 履歴欄 = $('fm-hist'), diff = $('fmdiff'), err = $('fmerr');
  var btnL = $('fm-load'), btnS = $('fm-save'), btnR = $('fm-reload');

  function 状態(m, k) { stat.textContent = m; stat.className = k || ''; }
  function 失敗(m) { err.textContent = m || ''; err.style.display = m ? 'block' : 'none'; }
  function 待機(on) {
    btnL.disabled = on;
    btnS.disabled = on || !現在;
    btnR.disabled = on || !現在;
    Array.prototype.forEach.call(document.querySelectorAll('#fmbar button.new'),
      function (b) { b.disabled = on; });
  }

  function 呼ぶ(name, args) {
    return new Promise(function (done, fail) {
      google.script.run
        .withSuccessHandler(function (r) {
          if (r && r.ok === false) fail(new Error(r.error || '不明なエラー')); else done(r);
        })
        .withFailureHandler(function (e) { fail(e); })
        [name].apply(null, args || []);
    });
  }

  // -------------------------------------------------- 画面に流し込む

  function 流し込む(rec) {
    現在 = rec; 読込時 = {};
    Object.keys(TO_FM).forEach(function (id) {
      var el = document.getElementById(id); if (!el) return;
      var v = rec.fields[TO_FM[id]];
      v = (v === undefined || v === null) ? '' : String(v);
      s(id, v); 読込時[id] = v; el.classList.remove('fm-dirty');
    });
    var 区分 = rec.fields['案件区分'] || '受注';
    段階札.textContent = 区分 + '  ' + (rec.fields['見積番号'] || rec.fields['伝票番号'] || '');
    段階札.className = STAGE_CLASS[区分] || '';
    try { calc(); } catch (e) {}
    try { onInk(); } catch (e) {}
    try { applyRowVis(); } catch (e) {}
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
      out[col] = now;
    });
    return out;
  }

  function 保存() {
    if (!現在) return;
    var 差 = 変更分(), n = Object.keys(差).length;
    if (!n) { 状態('変更はありません', ''); return; }
    if (!confirm(n + ' 項目を FileMaker に保存します。よろしいですか？\n\n'
                 + Object.keys(差).slice(0, 30).join('、')
                 + (n > 30 ? ' …ほか' + (n - 30) + '件' : ''))) return;
    待機(true); 失敗(''); 状態('保存中… ' + n + ' 項目');
    呼ぶ('画面_保存', [現在.recordId, 現在.modId, 差]).then(function (r) {
      if (r.conflict) { 失敗(r.message); 状態('保存できませんでした', 'err'); 待機(false); return; }
      流し込む({ recordId: r.recordId, modId: r.modId, fields: r.fields });
      状態(r.saved.length + ' 項目を保存しました（金額は再計算済み）', 'ok');
      待機(false);
    }).catch(function (e) { 状態(String(e.message || e), 'err'); 待機(false); });
  }

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
  document.body.insertBefore(diff, document.body.firstChild);
  document.body.insertBefore(bar, document.body.firstChild);
  番号欄.focus();
})();
</script>
"""


def main():
    src = open(SRC, encoding='utf-8').read()
    if '</body>' not in src:
        print('× </body> が見つかりません')
        return 1

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
