// ════════════════════════════════════════════════════════════════════════════
// FAXJUCHU-1（11/20 本多さん）: 「まとめて起票」
//   今まで Claude に頼んでいた ①北上プリントの FAX「年賀はがき受注票」（1 ページ 1 件・複数ページ）の起票
//   ②名刺・診察券などの「前回と同じ」リピートの起票 を、受注入力の画面だけでできるようにする。
//
//   ① PDF を入れる → AI（会社 GAS の claudeVision）でページごとに お名前・見本No（主文/添文/カット）・枚数・
//      はがき（持参/当社出し）・北上の印刷代・納期・メモ を読む → 一覧で直す → まとめて起票
//      （中継 画面_新規案件 → 画面_保存。当社出しは 官製ハガキ の「元番号-A」伝票も）
//   ② 元の伝票番号を並べる → 画面_流用新規（同じ案件=true）→ ロット区分 リピート・数量・納期を保存
//   ③ 起票した伝票を 1 枚の校正BOX カードにまとめ、Drive の 01_入稿データ に PDF、LINE WORKS ノートを作る
//      （Hub 本体の HubFaxBridge を直接呼ぶ。localStorage の待ち行列は使わない＝満杯の端末でも動く）
//
//   書き込みは「まとめて起票」「校正BOX・LINE WORKS へ」を押したときだけ。途中で失敗した行は、
//   もう一度押すと続きから（伝票はできていて書き込みだけ失敗した行は、同じ伝票に書き直す）。
// ════════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  if (/[?&]mode=(mitsu|ichiran)\b/.test(location.search)) return;   // 受注登録だけ

  var AI_URL = 'https://script.google.com/a/macros/tokiwap-group.com/s/AKfycbw9-8Nnq3jV9lCDUEf7JOvQM_yAy1ZYnOIab-TYP3TZ-BtH7RosxKSeXmr-FvkxMVhv/exec', AI_KEY = '';
  var 設定の鍵 = 'fm_fax_bulk_settings_v1';

  // 年賀状印刷の伝票に入れる値（列名=値）。{…} は一覧の値に置き換える。設定で直せる
  var 型_年賀 = [
    '得意先コード=5463', '品種=04', '製品名=年賀状印刷', 'ユーザー名={お名前}',
    'サイズ横=100', 'サイズ縦=148', '色数1=4', '切数1=1', 'パーツ数=1', '担当者コード=3',
    'ロット区分=新規', '単位=枚', 'インキ表1=カラー', '版下1=1/0', '版下変更=無',
    '紙質1=官製はがき', '紙質2=主文：{主文}', '紙質3=添文：{添文}', '紙質4=カット：{カット}',
    'ロット契約単位={枚数}', '注残数={枚数}', '売価単価={単価}', '納期={納期}', '備考={メモ}'
  ].join('\n');
  // 当社出しのときの -A 伝票: 年賀状の値に上書きするもの（伝票番号・no＝元番号-A、案件ID＝元番号 は自動）
  var 型_ハガキ = ['製品名=官製ハガキ', '売価単価=85'].join('\n');

  var 既定 = { 得意先名: '北上プリント', 掛け率: '0.5', 型: 型_年賀, 型A: 型_ハガキ, 見本: 'a109549' };
  var 設定 = 設定を読む();
  function 設定を読む() {
    var s = {}; try { s = JSON.parse(localStorage.getItem(設定の鍵) || '{}') || {}; } catch (e) { s = {}; }
    var o = {}; Object.keys(既定).forEach(function (k) { o[k] = (s[k] != null && s[k] !== '') ? String(s[k]) : 既定[k]; }); return o;
  }
  function 設定を書く() { try { localStorage.setItem(設定の鍵, JSON.stringify(設定)); return true; } catch (e) { return false; } }   // 満杯でも動く（覚えないだけ）

  var S = { tab: 'fax', file: null, pages: [], rows: [], rep: [], 実行中: false, 校正: { fax: null, rep: null }, 見る: 0, 選: -1 };

  // ---------------------------------------------------------------- 小道具
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function 数(s) { var m = String(s == null ? '' : s).normalize('NFKC').replace(/[,，]/g, '').match(/-?\d+(\.\d+)?/); return m ? Number(m[0]) : null; }
  function 呼ぶ(name, args) {
    if (!window.FM呼ぶ) return Promise.reject(new Error('中継の準備ができていません（受注入力を開き直してください）'));
    return window.FM呼ぶ(name, args).catch(function (e) { var m = String((e && e.message) || e); if (m.indexOf('［') !== 0) m = '［' + name + '］' + m; throw new Error(m); });
  }
  function 上限か(m) { return /上限を超えて|storage ?quota|quota ?exceeded|storageQuotaExceeded|insufficient ?storage/i.test(String(m || '')); }
  function 上限の文(m) { return 上限か(m) ? '　⚠ Google ドライブの容量の上限です。Drive の空きを作るまで PDF を置けません（ノートは添付なしで作ります）' : ''; }
  // YYYY-MM-DD / M/D → FileMaker の MM/DD/YYYY。年が無ければ今日以降でいちばん近い日
  function FM日付(v) {
    v = String(v || '').normalize('NFKC').trim(); if (!v) return '';
    var m = /^(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})/.exec(v), y, mo, d;
    if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
    else { m = /^(\d{1,2})[\/\-.月](\d{1,2})/.exec(v); if (!m) return ''; mo = +m[1]; d = +m[2]; var t = new Date(); y = t.getFullYear(); if (new Date(y, mo - 1, d) < new Date(t.getFullYear(), t.getMonth(), t.getDate())) y++; }
    if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return '';
    return ('0' + mo).slice(-2) + '/' + ('0' + d).slice(-2) + '/' + y;
  }
  function 画面日付(v) { var f = FM日付(v); if (!f) return ''; var p = f.split('/'); return p[2] + '-' + p[0] + '-' + p[1]; }
  function 単価(r) {
    var 印 = 数(r.印刷代), 枚 = 数(r.枚数), k = 数(設定.掛け率);
    if (!(印 > 0) || !(枚 > 0) || !(k > 0)) return '';
    return String(Math.round(印 * k / 枚 * 100) / 100);
  }
  function 型を読む(text) {
    var o = {}; String(text || '').split(/\r?\n/).forEach(function (ln) { var i = ln.indexOf('='); if (i <= 0) return; var k = ln.slice(0, i).trim(); if (k && !/^[#／\/]/.test(k)) o[k] = ln.slice(i + 1); }); return o;
  }
  // 1 行ぶんの伝票の値（はがき=true なら -A 伝票）。空の値は送らない
  function 伝票の値(r, はがき) {
    var 型 = 型を読む(設定.型); if (はがき) { var a = 型を読む(設定.型A); Object.keys(a).forEach(function (k) { 型[k] = a[k]; }); }
    var 置換 = { お名前: r.お名前, 主文: r.主文, 添文: r.添文, カット: r.カット, 枚数: 数(r.枚数) || '', 単価: 単価(r), 納期: FM日付(r.納期), メモ: r.メモ, 印刷代: 数(r.印刷代) || '' };
    var out = {};
    Object.keys(型).forEach(function (k) {
      var 空 = false;
      var v = String(型[k]).replace(/\{([^}]+)\}/g, function (_, n) { var x = 置換[n]; if (x == null || String(x).trim() === '') { 空 = true; return ''; } return String(x).trim(); });
      if (空 && /^\{[^}]+\}$/.test(String(型[k]).trim())) return;   // 値が {…} だけで空 → 入れない
      if (String(v).trim() === '' ) return;
      out[k] = v.trim();
    });
    return out;
  }

  // ---------------------------------------------------------------- 画面
  var CSS = ''
    + '#fxb{position:fixed;inset:0;z-index:10050;background:rgba(15,23,42,.55);display:flex;align-items:stretch;justify-content:center;font-family:"Yu Gothic","Meiryo",system-ui,sans-serif;color:#1a1a1a}'
    + '#fxb .w{background:#f7f6f3;width:min(1500px,100vw);display:flex;flex-direction:column;box-shadow:0 10px 40px rgba(0,0,0,.35)}'
    + '#fxb .hd{background:#1a1a1a;color:#fff;padding:9px 14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}'
    + '#fxb .hd b{font-size:15px}#fxb .hd .x{margin-left:auto;background:#fff;color:#1a1a1a;border:0;border-radius:5px;padding:4px 12px;font-weight:700;cursor:pointer}'
    + '#fxb .tabs{display:flex;gap:6px}#fxb .tabs button{background:#334155;color:#e2e8f0;border:0;border-radius:6px;padding:5px 12px;cursor:pointer;font-weight:700}#fxb .tabs button.on{background:#a3e635;color:#1a1a1a}'
    + '#fxb .bd{flex:1;overflow:auto;padding:10px 14px 30px}'
    + '#fxb .sec{background:#fff;border:1px solid #e0ddd6;border-radius:8px;padding:10px 12px;margin-bottom:10px}'
    + '#fxb .st{font-size:11px;font-weight:700;color:#6b7280;letter-spacing:.06em;margin-bottom:6px}'
    + '#fxb .btn{font:inherit;border:1px solid #c9c6bf;background:#fff;border-radius:6px;padding:6px 13px;cursor:pointer;font-weight:600}'
    + '#fxb .btn.p{background:#1a1a1a;color:#fff;border-color:#1a1a1a}#fxb .btn.g{background:#15803d;color:#fff;border-color:#15803d}#fxb .btn.v{background:#5b21b6;color:#fff;border-color:#5b21b6}'
    + '#fxb .btn:disabled{opacity:.45;cursor:default}'
    + '#fxb .drop{border:2px dashed #c9c6bf;border-radius:10px;padding:18px;text-align:center;color:#6b7280;background:#fff}#fxb .drop.on{border-color:#1a1a1a}'
    + '#fxb table{border-collapse:collapse;width:100%;background:#fff;font-size:12.5px}'
    + '#fxb th,#fxb td{border:1px solid #e2e0da;padding:3px 4px;vertical-align:middle}#fxb th{background:#f1efe9;font-size:11px;color:#4b5563;white-space:nowrap;position:sticky;top:0;z-index:1}'
    + '#fxb td input,#fxb td select{width:100%;border:1px solid transparent;background:transparent;font:inherit;padding:3px 4px;border-radius:3px}#fxb td input:focus,#fxb td select:focus{border-color:#1a1a1a;background:#fff;outline:none}'
    + '#fxb td.n{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}#fxb tr.sel td{background:#fffbeb}#fxb tr.done td{background:#ecfdf5}#fxb tr.ng td{background:#fef2f2}#fxb tr.off td{opacity:.45}'
    + '#fxb td.warn input{background:#fef3c7}'
    + '#fxb .grid{display:grid;grid-template-columns:minmax(0,1fr) 420px;gap:10px;align-items:start}@media(max-width:1100px){#fxb .grid{grid-template-columns:1fr}}'
    + '#fxb .pv{position:sticky;top:0;background:#fff;border:1px solid #e0ddd6;border-radius:8px;padding:6px}#fxb .pv img{width:100%;display:block;cursor:zoom-in}#fxb .pv.big img{cursor:zoom-out;width:200%}'
    + '#fxb .pvw{max-height:calc(100vh - 170px);overflow:auto}'
    + '#fxb .msg{font-size:12.5px;margin-top:6px;white-space:pre-wrap}#fxb .err{color:#b91c1c;font-weight:700}#fxb .ok{color:#15803d;font-weight:700}'
    + '#fxb .full{background:#b91c1c;color:#fff;font-weight:700;padding:8px 12px;border-radius:6px;margin:6px 0}'
    + '#fxb textarea{width:100%;font:12px/1.5 Consolas,"Yu Gothic",monospace;border:1px solid #c9c6bf;border-radius:6px;padding:6px}'
    + '#fxb .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}#fxb .row label{font-size:12px;color:#4b5563}#fxb .row input[type=text]{border:1px solid #c9c6bf;border-radius:5px;padding:4px 7px;font:inherit}'
    + '#fxb .tag{display:inline-block;font-size:10.5px;font-weight:700;padding:1px 6px;border-radius:9px;background:#e0e7ff;color:#3730a3}'
    + '#fxb a{color:#0369a1}';

  function 開く() {
    try { var k = window.FM道具 && FM道具.権限 && FM道具.権限(); if (k && k.partner) { alert('まとめて起票はトキワの社内だけで使えます'); return; } } catch (e) {}
    var w = $('fxb'); if (w) { w.style.display = 'flex'; 描く(); return; }
    if (!$('fxb-css')) { var st = document.createElement('style'); st.id = 'fxb-css'; st.textContent = CSS; document.head.appendChild(st); }
    w = document.createElement('div'); w.id = 'fxb';
    w.innerHTML = '<div class="w"><div class="hd"><b>📠 まとめて起票</b><div class="tabs"><button data-t="fax">FAX 受注票（年賀状）</button><button data-t="rep">リピート（前回と同じ）</button></div>'
      + '<span id="fxb-who" style="font-size:11px;color:#cbd5e1"></span><button class="x" id="fxb-x">閉じる</button></div><div class="bd" id="fxb-bd"></div></div>';
    document.body.appendChild(w);
    $('fxb-x').onclick = function () { if (S.実行中 && !confirm('起票の途中です。閉じても裏で続きます（結果はもう一度開くと見えます）。閉じますか？')) return; w.style.display = 'none'; };
    Array.prototype.forEach.call(w.querySelectorAll('.tabs button'), function (b) { b.onclick = function () { S.tab = b.getAttribute('data-t'); 描く(); }; });
    描く();
  }

  function 描く() {
    Array.prototype.forEach.call(document.querySelectorAll('#fxb .tabs button'), function (b) { b.classList.toggle('on', b.getAttribute('data-t') === S.tab); });
    var who = ''; try { who = window.FM名乗っている ? FM名乗っている() : ''; } catch (e) {}
    $('fxb-who').textContent = who ? ('FileMaker: ' + who) : 'FileMaker: まだサインインしていません（起票のときにサインインを求めます）';
    if (S.tab === 'rep') リピートを描く(); else FAXを描く();
  }

  // ================================================================ ① FAX 受注票
  function FAXを描く() {
    var bd = $('fxb-bd');
    var h = [];
    h.push('<div class="sec"><div class="st">1. FAX の PDF を入れる（1 ページ 1 件）</div>'
      + '<div class="drop" id="fxb-drop">ここに PDF（または画像）をドロップ　<button class="btn" id="fxb-pick">ファイルを選ぶ</button><input type="file" id="fxb-file" accept=".pdf,image/*" hidden>'
      + (S.file ? '<div style="margin-top:6px;color:#1a1a1a">📄 <b>' + esc(S.file.name) + '</b>　' + S.pages.length + ' ページ</div>' : '') + '</div>'
      + '<div class="row" style="margin-top:8px"><button class="btn v" id="fxb-ai"' + (S.pages.length ? '' : ' disabled') + '>🤖 AI で全ページを読む</button>'
      + '<button class="btn" id="fxb-addrow">＋ 行を足す（手で入れる）</button><span class="msg" id="fxb-aimsg"></span></div></div>');
    h.push('<div class="sec"><div class="st">2. 読み取りを確かめて直す（行をクリックすると右にそのページ）</div><div class="grid"><div style="overflow:auto">' + FAX表() + '</div>'
      + '<div class="pv" id="fxb-pv"><div class="pvw" id="fxb-pvw">' + ページ画像(S.見る) + '</div></div></div>'
      + '<div class="msg" id="fxb-sum">' + 合計の文() + '</div></div>');
    h.push('<div class="sec"><div class="st">3. まとめて起票（FileMaker に受注伝票を作る）</div>'
      + '<div class="row"><button class="btn g" id="fxb-go">✅ チェックした行をまとめて起票</button>'
      + '<button class="btn" id="fxb-copy">結果をコピー</button>'
      + '<details style="margin-left:6px"><summary style="cursor:pointer;font-size:12px">⚙ 伝票に入れる値・見本と比べる</summary>' + 設定欄() + '</details></div>'
      + '<div class="msg" id="fxb-gomsg"></div></div>');
    h.push(校正欄('fax'));
    bd.innerHTML = h.join('');
    // ファイル
    var drop = $('fxb-drop');
    $('fxb-pick').onclick = function () { $('fxb-file').click(); };
    $('fxb-file').onchange = function () { if (this.files[0]) ファイルを入れる(this.files[0]); };
    ['dragenter', 'dragover'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('on'); }); });
    ['dragleave', 'drop'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove('on'); }); });
    drop.addEventListener('drop', function (e) { var f = e.dataTransfer.files[0]; if (f) ファイルを入れる(f); });
    $('fxb-ai').onclick = 全部読む;
    $('fxb-addrow').onclick = function () { S.rows.push(空の行(S.rows.length ? S.rows[S.rows.length - 1].page : 0)); FAXを描く(); };
    $('fxb-go').onclick = FAX起票;
    $('fxb-copy').onclick = function () { 写す(S.rows.filter(function (r) { return r.no; }).map(function (r) { return [r.no, r.noA || '', r.お名前, r.枚数, '主文：' + r.主文, '添文：' + r.添文, 'カット：' + r.カット, r.はがき, r.印刷代, 単価(r), r.納期, r.メモ].join('\t'); }).join('\n'), $('fxb-gomsg')); };
    表のつなぎ(); 設定のつなぎ(); 校正のつなぎ('fax');
    var pv = $('fxb-pv'); if (pv) pv.onclick = function (e) { if (e.target.tagName === 'IMG') pv.classList.toggle('big'); };
  }
  function 空の行(page) { return { on: true, page: page || 0, お名前: '', 主文: '', 添文: '', カット: '', 枚数: '', はがき: '', 印刷代: '', 納期: '', メモ: '', 気になる: [], 状態: '', no: '', noA: '' }; }
  function FAX表() {
    if (!S.rows.length) return '<div style="padding:24px;text-align:center;color:#6b7280">PDF を入れて「AI で全ページを読む」を押すと、ここに 1 ページ 1 行で並びます</div>';
    var h = ['<table><thead><tr><th>起票</th><th>頁</th><th>お名前</th><th>主文</th><th>添文</th><th>カット</th><th>枚数</th><th>はがき</th><th>北上の印刷代</th><th>単価</th><th>納期</th><th>メモ</th><th>結果</th></tr></thead><tbody>'];
    S.rows.forEach(function (r, i) {
      var cls = (r.no && (r.はがき !== '当社出し' || r.noA) && r.書いた) ? 'done' : (r.err ? 'ng' : ''); if (!r.on) cls += ' off'; if (i === S.選 ) cls += ' sel';
      var w = function (k) { return (r.気になる || []).indexOf(k) >= 0 ? ' class="warn" title="AI が自信なし"' : ''; };
      var 済 = !!r.no;
      h.push('<tr data-i="' + i + '" class="' + cls + '">',
        '<td style="text-align:center"><input type="checkbox" data-k="on"' + (r.on ? ' checked' : '') + (済 ? ' disabled' : '') + '></td>',
        '<td class="n">' + (r.page ? r.page : '') + '</td>',
        '<td' + w('お名前') + '><input data-k="お名前" value="' + esc(r.お名前) + '" style="min-width:110px"></td>',
        '<td' + w('主文') + '><input data-k="主文" value="' + esc(r.主文) + '" style="width:64px"></td>',
        '<td' + w('添文') + '><input data-k="添文" value="' + esc(r.添文) + '" style="width:64px"></td>',
        '<td' + w('カット') + '><input data-k="カット" value="' + esc(r.カット) + '" style="width:64px"></td>',
        '<td' + w('枚数') + '><input data-k="枚数" value="' + esc(r.枚数) + '" style="width:60px;text-align:right"></td>',
        '<td' + w('はがき') + '><select data-k="はがき"><option value=""' + (r.はがき ? '' : ' selected') + '>？</option><option' + (r.はがき === '持参' ? ' selected' : '') + '>持参</option><option' + (r.はがき === '当社出し' ? ' selected' : '') + '>当社出し</option></select></td>',
        '<td' + w('印刷代') + '><input data-k="印刷代" value="' + esc(r.印刷代) + '" style="width:76px;text-align:right"></td>',
        '<td class="n" data-u>' + esc(単価(r)) + '</td>',
        '<td' + w('納期') + '><input type="date" data-k="納期" value="' + esc(画面日付(r.納期)) + '"></td>',
        '<td><input data-k="メモ" value="' + esc(r.メモ) + '" style="min-width:120px"></td>',
        '<td style="font-size:11.5px;min-width:120px">' + 行の結果(r) + '</td></tr>');
    });
    h.push('</tbody></table>');
    return h.join('');
  }
  function 行の結果(r) {
    var s = '';
    if (r.no) s += '<a href="fm-juchu-hub.html?no=' + encodeURIComponent(r.no) + '" target="_blank"><b>' + esc(r.no) + '</b></a>' + (r.書いた ? '' : ' <span class="err">書き込み未</span>');
    if (r.noA) s += '<br><a href="fm-juchu-hub.html?no=' + encodeURIComponent(r.noA) + '" target="_blank">' + esc(r.noA) + '</a>';
    else if (r.recA) s += '<br><span class="err">-A 書き込み未（' + esc(r.recA.auto || '') + '）</span>';
    if (r.状態) s += (s ? '<br>' : '') + esc(r.状態);
    if (r.err) s += (s ? '<br>' : '') + '<span class="err">' + esc(r.err) + '</span>';
    return s;
  }
  function 表のつなぎ() {
    Array.prototype.forEach.call(document.querySelectorAll('#fxb-bd tbody tr[data-i]'), function (tr) {
      var i = +tr.getAttribute('data-i'), r = S.rows[i]; if (!r) return;
      tr.addEventListener('click', function () { if (S.選 === i) return; S.選 = i; if (r.page) { S.見る = r.page; var pw = $('fxb-pvw'); if (pw) pw.innerHTML = ページ画像(r.page); }
        Array.prototype.forEach.call(document.querySelectorAll('#fxb-bd tbody tr'), function (t) { t.classList.toggle('sel', t === tr); }); });
      Array.prototype.forEach.call(tr.querySelectorAll('[data-k]'), function (el) {
        var k = el.getAttribute('data-k');
        el.addEventListener(el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input', function () {
          if (k === 'on') r.on = el.checked; else r[k] = el.value;
          if (r.気になる) r.気になる = r.気になる.filter(function (x) { return x !== k; });
          var u = tr.querySelector('[data-u]'); if (u) u.textContent = 単価(r);
          tr.classList.toggle('off', !r.on); var s = $('fxb-sum'); if (s) s.innerHTML = 合計の文();
        });
      });
    });
  }
  function 合計の文() {
    if (!S.rows.length) return '';
    var on = S.rows.filter(function (r) { return r.on; }), 枚 = 0, 当社 = 0, 未 = [];
    on.forEach(function (r, i) { 枚 += 数(r.枚数) || 0; if (r.はがき === '当社出し') 当社++; var miss = 足りない(r); if (miss.length) 未.push((r.お名前 || ('頁' + r.page)) + '：' + miss.join('・')); });
    return '起票する ' + on.length + ' 件（官製ハガキ -A ' + 当社 + ' 件）・合計 ' + 枚.toLocaleString() + ' 枚'
      + (未.length ? '<br><span class="err">足りない: ' + esc(未.join('　／　')) + '</span>' : '');
  }
  function 足りない(r) { var m = []; if (!String(r.お名前 || '').trim()) m.push('お名前'); if (!(数(r.枚数) > 0)) m.push('枚数'); if (!r.はがき) m.push('はがき'); if (!(数(r.印刷代) > 0)) m.push('印刷代'); if (!FM日付(r.納期)) m.push('納期'); return m; }
  function ページ画像(n) {
    var p = S.pages[(n || 1) - 1]; if (!p) return '<div style="padding:30px;color:#6b7280;text-align:center">ページの画像がここに出ます</div>';
    return '<div style="font-size:11px;color:#6b7280;margin-bottom:3px">' + n + ' / ' + S.pages.length + ' ページ（クリックで拡大）</div><img src="' + p.url + '" alt="">';
  }

  // ---- PDF → ページ画像
  function pdfjs() { if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib); return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'; s.onload = function () { window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'; res(window.pdfjsLib); }; s.onerror = function () { rej(new Error('PDF を読む部品を読み込めません')); }; document.head.appendChild(s); }); }
  function 縮める(c, max) { var sc = Math.min(1, max / Math.max(c.width, c.height)); if (sc >= 1) return c; var c2 = document.createElement('canvas'); c2.width = Math.round(c.width * sc); c2.height = Math.round(c.height * sc); c2.getContext('2d').drawImage(c, 0, 0, c2.width, c2.height); return c2; }
  function ファイルを入れる(f) {
    if (S.rows.some(function (r) { return r.no; }) && !confirm('起票した行があります。新しい PDF に入れ替えると、この一覧は消えます（起票した伝票はそのまま）。入れ替えますか？')) return;
    S.file = f; S.pages = []; S.rows = []; S.校正.fax = null; S.見る = 1; S.選 = -1;
    var msg = function (t, k) { var m = $('fxb-aimsg'); if (m) { m.textContent = t; m.className = 'msg ' + (k || ''); } };
    FAXを描く(); msg('ページを画像にしています…');
    var 一枚 = function (c) { var big = 縮める(c, 1800); return { url: big.toDataURL('image/jpeg', 0.85), b64: big.toDataURL('image/jpeg', 0.85).split(',')[1] }; };
    var p;
    if (/pdf/i.test(f.type) || /\.pdf$/i.test(f.name)) {
      p = pdfjs().then(function (lib) { return f.arrayBuffer().then(function (buf) { return lib.getDocument({ data: buf }).promise; }); }).then(function (doc) {
        var out = [], i = 0;
        var next = function () { i++; if (i > doc.numPages) return Promise.resolve(out); msg('ページを画像にしています… ' + i + ' / ' + doc.numPages);
          return doc.getPage(i).then(function (pg) { var vp = pg.getViewport({ scale: 2 }); var c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height; var ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
            return pg.render({ canvasContext: ctx, viewport: vp }).promise.then(function () { out.push(一枚(c)); return next(); }); }); };
        return next();
      });
    } else {
      p = new Promise(function (res, rej) { var img = new Image(); img.onload = function () { var c = document.createElement('canvas'); c.width = img.width; c.height = img.height; c.getContext('2d').drawImage(img, 0, 0); res([一枚(c)]); }; img.onerror = function () { rej(new Error('画像を読めません')); }; img.src = URL.createObjectURL(f); });
    }
    p.then(function (pages) { S.pages = pages; S.rows = pages.map(function (_, i) { return 空の行(i + 1); }); FAXを描く(); msg(pages.length + ' ページ。「AI で全ページを読む」を押してください', 'ok'); })
      .catch(function (e) { msg(String(e.message || e), 'err'); });
  }

  // ---- AI で読む（会社 GAS の claudeVision。1 ページずつ、2 つ並べて）
  function 指示() {
    var t = new Date(), today = t.getFullYear() + '-' + ('0' + (t.getMonth() + 1)).slice(-2) + '-' + ('0' + t.getDate()).slice(-2);
    return '印刷会社に北上プリントから FAX で届いた「年賀はがき受注票」1 ページのスキャンです。書いてある内容だけを、次の JSON 1 つで返してください（説明文は書かない）。\n'
      + '{"受注票":true,"お名前":"","主文":"","添文":"","カット":"","枚数":0,"はがき":"","印刷代":0,"納期":"","メモ":"","自信がない":[]}\n'
      + '・お名前＝ご注文のお客様のお名前（様は付けない）。会社名ならそのまま\n'
      + '・主文・添文・カット＝見本の番号・記号を書いてあるとおりに（例 "A-12" "N3"）。無ければ空\n'
      + '・枚数＝印刷する枚数（数字だけ）\n'
      + '・はがき＝お客様がはがきを持ってくる・支給なら "持参"、印刷会社（当社・北上）がはがきを用意するなら "当社出し"。分からなければ空\n'
      + '・印刷代＝印刷代の金額（円、数字だけ。はがき代・合計ではなく印刷代の欄）。無ければ 0\n'
      + '・納期＝YYYY-MM-DD。年が書いていなければ今日（' + today + '）以降でいちばん近い日\n'
      + '・メモ＝手書きの指示・注意・宛名印刷の有無・差出人の住所変更など、上の欄に入らないこと（短く）\n'
      + '・自信がない＝読み取りに自信がない欄の名前の配列（例 ["主文","枚数"]）\n'
      + '・年賀はがきの受注票でないページ（送付状・白紙など）は {"受注票":false} だけ\n'
      + '・書いていないことは推測で埋めない';
  }
  function AIで読む(b64) {
    var u = new URL(AI_URL); u.searchParams.set('action', 'claudeVision'); u.searchParams.set('apiKey', AI_KEY);
    return fetch(u.toString(), { method: 'POST', redirect: 'follow', body: JSON.stringify({ prompt: 指示(), images: [b64], maxTokens: 1200 }) })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || !j.success) { var m = String((j && j.error) || '応答なし'); if (/daily_limit/.test(m)) m = '今日の AI の上限に達しました（明日 0 時に戻ります）'; else if (/ai_disabled/.test(m)) m = 'AI が止められています'; throw new Error(m); }
        var t = String(j.reply || j.text || ''), a = t.indexOf('{'), b = t.lastIndexOf('}');
        if (a < 0 || b < a) throw new Error('AI の返事を読めませんでした: ' + t.slice(0, 80));
        return JSON.parse(t.slice(a, b + 1));
      });
  }
  function 全部読む() {
    if (!S.pages.length) return;
    if (S.rows.some(function (r) { return r.no; })) { alert('起票した行があるので、読み直しはできません（新しい PDF を入れてください）'); return; }
    var btn = $('fxb-ai'); btn.disabled = true;
    var msg = function (t, k) { var m = $('fxb-aimsg'); if (m) { m.textContent = t; m.className = 'msg ' + (k || ''); } };
    var rows = S.pages.map(function (_, i) { return 空の行(i + 1); }), 済 = 0, 失敗 = 0, 次 = 0;
    var 一つ = function () {
      var i = 次++; if (i >= S.pages.length) return Promise.resolve();
      return AIで読む(S.pages[i].b64).then(function (o) {
        var r = rows[i];
        if (o && o.受注票 === false) { r.on = false; r.状態 = '受注票ではないページ'; }
        else {
          ['お名前', '主文', '添文', 'カット', 'メモ'].forEach(function (k) { r[k] = String((o && o[k]) || '').trim(); });
          r.お名前 = r.お名前.replace(/\s*様$/, '');
          r.枚数 = 数(o && o.枚数) > 0 ? String(数(o.枚数)) : '';
          r.印刷代 = 数(o && o.印刷代) > 0 ? String(数(o.印刷代)) : '';
          r.はがき = /持/.test(String(o && o.はがき || '')) ? '持参' : /当社|出し|手配|用意/.test(String(o && o.はがき || '')) ? '当社出し' : '';
          r.納期 = 画面日付(o && o.納期);
          r.気になる = Array.isArray(o && o.自信がない) ? o.自信がない.map(String) : [];
        }
      }).catch(function (e) { rows[i].err = 'AI: ' + String(e.message || e); 失敗++; })
        .then(function () { 済++; msg('AI で読んでいます… ' + 済 + ' / ' + S.pages.length + (失敗 ? '（失敗 ' + 失敗 + '）' : '')); return 一つ(); });
    };
    msg('AI で読んでいます… 0 / ' + S.pages.length);
    Promise.all([一つ(), 一つ()]).then(function () {
      S.rows = rows; FAXを描く();
      msg('読み終わりました（' + rows.length + ' ページ' + (失敗 ? '・失敗 ' + 失敗 + '：その行は手で入れるか、もう一度押してください' : '') + '）。黄色の欄は AI が自信なし。FAX と見比べてください', 失敗 ? 'err' : 'ok');
    });
  }

  // ---- 起票
  function 書く(rec, vals) {
    var 元 = {}; Object.keys(vals).forEach(function (k) { var v = rec.fields ? rec.fields[k] : ''; 元[k] = v == null ? '' : String(v); });
    return 呼ぶ('画面_保存', [rec.recordId, rec.modId, vals, 元, false]).then(function (s) {
      if (s && s.conflict) return 呼ぶ('画面_保存', [s.recordId, s.modId, vals, 元, true]);
      return s;
    }).then(function (s) { if (s && s.conflict) throw new Error('別の人が同時に直しています（' + (s.message || '') + '）'); return s; });
  }
  function 読み直す(recordId) { return 呼ぶ('画面_recordIdで読む', [String(recordId)]).then(function (r) { return r.record; }); }
  function 無視の文(s) { return (s && s.ignored && s.ignored.length) ? '書けない項目（入れていません）: ' + s.ignored.join('、') : ''; }

  function FAX起票() {
    if (S.実行中) return;
    var 対象 = S.rows.filter(function (r) { return r.on && !(r.no && r.書いた && (r.はがき !== '当社出し' || r.noA)); });
    var msg = function (t, k) { var m = $('fxb-gomsg'); if (m) { m.innerHTML = t; m.className = 'msg ' + (k || ''); } };
    if (!対象.length) { msg('起票する行がありません（チェックを入れてください。起票済みの行は飛ばします）'); return; }
    var 不足 = 対象.filter(function (r) { return 足りない(r).length; });
    if (不足.length) { msg('足りない欄があります: ' + esc(不足.map(function (r) { return (r.お名前 || ('頁' + r.page)) + '（' + 足りない(r).join('・') + '）'; }).join('　')), 'err'); return; }
    var 名 = {}, 重 = []; S.rows.forEach(function (r) { if (!r.on) return; var k = String(r.お名前).replace(/\s/g, ''); if (名[k]) 重.push(r.お名前); 名[k] = 1; });
    var nA = 対象.filter(function (r) { return r.はがき === '当社出し' && !r.noA; }).length;
    var 見本 = 伝票の値(対象[0], false);
    if (!confirm('FileMaker に受注伝票を作ります。\n\n年賀状印刷 ' + 対象.filter(function (r) { return !r.no; }).length + ' 件' + (nA ? '・官製ハガキ（-A）' + nA + ' 件' : '')
      + (重.length ? '\n\n⚠ 同じお名前が 2 回あります: ' + 重.join('、') : '')
      + '\n\n1 件目に入れる値:\n' + Object.keys(見本).map(function (k) { return '  ' + k + ' = ' + 見本[k]; }).join('\n') + '\n\nよろしいですか？')) return;
    S.実行中 = true; var btn = $('fxb-go'); if (btn) btn.disabled = true;
    var i = 0, ok = 0, ng = 0, 注意 = [];
    var 次 = function () {
      if (i >= 対象.length) {
        S.実行中 = false; FAXを描く();
        msg((ng ? '<span class="err">' + ng + ' 件失敗（もう一度押すと続きから）</span>　' : '') + '<span class="ok">' + ok + ' 件 起票しました</span>' + (注意.length ? '<br>' + esc(注意.join('\n')) : '') + (ng ? '' : '<br>次は下の「4. 校正BOX・LINE WORKS へ」'));
        return;
      }
      var r = 対象[i++]; r.err = ''; msg('起票しています… ' + i + ' / ' + 対象.length + '　' + esc(r.お名前));
      一行起票(r).then(function (s) { ok++; if (s) 注意.push(r.no + ': ' + s); })
        .catch(function (e) { ng++; r.err = String(e.message || e); })
        .then(function () { try { var tr = document.querySelector('#fxb-bd tr[data-i="' + S.rows.indexOf(r) + '"]'); if (tr) { tr.lastElementChild.innerHTML = 行の結果(r); tr.className = r.err ? 'ng' : 'done'; } } catch (e) {} 次(); });
    };
    次();
  }
  // 1 行: 年賀状印刷の伝票 → （当社出しなら）官製ハガキの -A 伝票。途中で止まっても続きから
  function 一行起票(r) {
    var 注 = [];
    var 本 = Promise.resolve();
    if (!r.no || !r.書いた) {
      本 = (r.no ? 読み直す(r.recordId) : 呼ぶ('画面_新規案件', ['受注', {}]).then(function (a) {
        var rec = a.record; r.recordId = rec.recordId; r.no = String(rec.fields['伝票番号'] || a.案件ID || ''); r.状態 = ''; return rec; }))
        .then(function (rec) { return 書く(rec, 伝票の値(r, false)); })
        .then(function (s) { r.書いた = true; var t = 無視の文(s); if (t) 注.push(t); });
    }
    return 本.then(function () {
      if (r.はがき !== '当社出し' || r.noA) return;
      var noA = r.no + '-A';
      var p = r.recA ? 読み直す(r.recA.recordId) : 呼ぶ('画面_新規案件', ['受注', {}]).then(function (b) { r.recA = { recordId: b.record.recordId, auto: String(b.record.fields['伝票番号'] || '') }; return b.record; });
      return p.then(function (rec) {
        var v = 伝票の値(r, true); v['伝票番号'] = noA; v['no'] = noA; v['案件ID'] = r.no;
        return 書く(rec, v);
      }).then(function (s) { r.noA = noA; var t = 無視の文(s); if (t) 注.push('-A ' + t); });
    }).then(function () { return 注.join(' ／ '); });
  }

  // ---- 設定（伝票に入れる値）と見本との比べ
  function 設定欄() {
    return '<div style="margin-top:6px;display:grid;grid-template-columns:1fr 1fr;gap:10px;min-width:min(900px,90vw)">'
      + '<div><div class="st">年賀状印刷の伝票（列名=値。{お名前}{主文}{添文}{カット}{枚数}{単価}{納期}{メモ}{印刷代} は一覧から）</div><textarea id="fxb-tpl" rows="16">' + esc(設定.型) + '</textarea></div>'
      + '<div><div class="st">当社出しの -A 伝票で上書きする値（伝票番号・no＝元番号-A、案件ID＝元番号 は自動）</div><textarea id="fxb-tplA" rows="4">' + esc(設定.型A) + '</textarea>'
      + '<div class="row" style="margin-top:6px"><label>単価＝印刷代 ×</label><input type="text" id="fxb-rate" value="' + esc(設定.掛け率) + '" style="width:50px"><label>÷ 枚数（小数 2 桁）</label></div>'
      + '<div class="row" style="margin-top:6px"><label>校正BOX の得意先名</label><input type="text" id="fxb-cname" value="' + esc(設定.得意先名) + '" style="width:140px"></div>'
      + '<div class="row" style="margin-top:8px"><button class="btn" id="fxb-save">この値を使う</button><button class="btn" id="fxb-reset">最初の値に戻す</button></div>'
      + '<div class="st" style="margin-top:12px">見本の伝票と比べる（読むだけ。書き込みません）</div>'
      + '<div class="row"><input type="text" id="fxb-sample" value="' + esc(設定.見本) + '" style="width:110px"><button class="btn" id="fxb-cmp">比べる</button></div>'
      + '<div id="fxb-cmpout" class="msg"></div></div></div>';
  }
  function 設定のつなぎ() {
    var sv = $('fxb-save'); if (!sv) return;
    sv.onclick = function () { 設定.型 = $('fxb-tpl').value; 設定.型A = $('fxb-tplA').value; 設定.掛け率 = $('fxb-rate').value.trim() || '0.5'; 設定.得意先名 = $('fxb-cname').value.trim(); 設定.見本 = $('fxb-sample').value.trim();
      var ok = 設定を書く(); 描く(); var m = $('fxb-gomsg'); if (m) m.textContent = 'この値で起票します' + (ok ? '' : '（この端末は保存場所が満杯なので、閉じると最初の値に戻ります）'); };
    $('fxb-reset').onclick = function () { if (!confirm('伝票に入れる値を最初の値に戻しますか？')) return; Object.keys(既定).forEach(function (k) { 設定[k] = 既定[k]; }); 設定を書く(); 描く(); };
    $('fxb-cmp').onclick = function () {
      var no = $('fxb-sample').value.trim(), out = $('fxb-cmpout'); if (!no) return;
      out.textContent = no + ' を読んでいます…';
      呼ぶ('画面_読み込み', [no]).then(function (r) {
        var f = (r && r.record && r.record.fields) || {}; if (!r || !r.record) throw new Error(no + ' が見つかりません');
        var 例 = S.rows.filter(function (x) { return x.on; })[0] || { お名前: '（お名前）', 主文: '（主文）', 添文: '（添文）', カット: '（カット）', 枚数: '100', 印刷代: '5000', 納期: '', メモ: '' };
        var A = /-A$/.test(no), v = 伝票の値(例, A), 型 = 型を読む(設定.型); if (A) { var a = 型を読む(設定.型A); Object.keys(a).forEach(function (k) { 型[k] = a[k]; }); }
        var h = ['<table><thead><tr><th>列</th><th>このツールの値（' + esc(例.お名前) + '）</th><th>' + esc(no) + ' の値</th><th></th></tr></thead><tbody>'];
        Object.keys(型).forEach(function (k) { var 見 = f[k] == null ? '（列なし）' : String(f[k]); var 同 = /\{/.test(型[k]) ? '—' : (String(v[k] || '') === 見 ? '✓' : '<b style="color:#b91c1c">違う</b>');
          h.push('<tr><td>' + esc(k) + '</td><td>' + esc(v[k] == null ? '' : v[k]) + '</td><td>' + esc(見) + '</td><td style="text-align:center">' + 同 + '</td></tr>'); });
        h.push('</tbody></table>');
        var 他 = Object.keys(f).filter(function (k) { return !(k in 型) && f[k] !== '' && f[k] != null && !/^(伝票番号|no|案件ID|案件区分|起票日|修正日|作成|修正|recordId)/.test(k); });
        h.push('<details style="margin-top:4px"><summary style="cursor:pointer">見本に入っていて、このツールが入れない列（' + 他.length + '）</summary><div style="font-size:11.5px;line-height:1.7">' + 他.map(function (k) { return esc(k) + ' = <b>' + esc(f[k]) + '</b>'; }).join('　') + '</div></details>');
        out.innerHTML = h.join('');
      }).catch(function (e) { out.innerHTML = '<span class="err">' + esc(e.message || e) + '</span>'; });
    };
  }

  // ================================================================ ② リピート（前回と同じ）
  function 空のリピート() { return { 元: '', 数量: '', 納期: '', メモ: '', 品名: '', 前回数量: '', ユーザー: '', 状態: '', no: '', recordId: '', 書いた: false, err: '' }; }
  function リピートを描く() {
    if (!S.rep.length) S.rep = [空のリピート(), 空のリピート(), 空のリピート()];
    var bd = $('fxb-bd'), h = [];
    h.push('<div class="sec"><div class="st">1. 元の伝票番号を並べる（名刺・診察券など「前回と同じ」）</div>'
      + '<div style="font-size:12px;color:#4b5563;margin-bottom:6px">1 行に「伝票番号 数量 納期 メモ」で貼り付けても入ります（例: <code>a108123 200 12/10 住所変更あり</code>）。数量が空なら前回のまま。'
      + '中継の <b>画面_流用新規（同じ案件）</b> で写し、前回伝票番号を付け、ロット区分を <b>リピート</b> にして保存します。</div>'
      + '<div class="row"><textarea id="fxr-paste" rows="3" placeholder="a108123 200 12/10" style="flex:1"></textarea><button class="btn" id="fxr-take">貼り付けを表に入れる</button></div></div>');
    h.push('<div class="sec"><div class="st">2. 確かめる（元の伝票を読むだけ）→ 3. まとめて起票</div><table><thead><tr><th>元の伝票番号</th><th>品名（元）</th><th>ユーザー（元）</th><th>前回数量</th><th>数量</th><th>納期</th><th>メモ（備考に足す）</th><th>結果</th><th></th></tr></thead><tbody>');
    S.rep.forEach(function (r, i) {
      h.push('<tr data-r="' + i + '" class="' + (r.no && r.書いた ? 'done' : r.err ? 'ng' : '') + '">',
        '<td><input data-k="元" value="' + esc(r.元) + '" style="width:100px"' + (r.no ? ' disabled' : '') + '></td>',
        '<td>' + esc(r.品名) + '</td><td>' + esc(r.ユーザー) + '</td><td class="n">' + esc(r.前回数量) + '</td>',
        '<td><input data-k="数量" value="' + esc(r.数量) + '" style="width:70px;text-align:right"' + (r.書いた ? ' disabled' : '') + '></td>',
        '<td><input type="date" data-k="納期" value="' + esc(画面日付(r.納期)) + '"' + (r.書いた ? ' disabled' : '') + '></td>',
        '<td><input data-k="メモ" value="' + esc(r.メモ) + '"' + (r.書いた ? ' disabled' : '') + '></td>',
        '<td style="font-size:11.5px">' + (r.no ? '<a href="fm-juchu-hub.html?no=' + encodeURIComponent(r.no) + '" target="_blank"><b>' + esc(r.no) + '</b></a>' + (r.書いた ? '' : ' <span class="err">書き込み未</span>') : '') + (r.状態 ? ' ' + esc(r.状態) : '') + (r.err ? '<br><span class="err">' + esc(r.err) + '</span>' : '') + '</td>',
        '<td>' + (r.no ? '' : '<button class="btn" data-del style="padding:1px 7px">×</button>') + '</td></tr>');
    });
    h.push('</tbody></table><div class="row" style="margin-top:6px"><button class="btn" id="fxr-add">＋ 行</button><button class="btn" id="fxr-check">🔎 元の伝票を確かめる</button>'
      + '<button class="btn g" id="fxr-go">✅ まとめて起票（リピート）</button><button class="btn" id="fxr-copy">結果をコピー</button></div><div class="msg" id="fxr-msg"></div></div>');
    h.push(校正欄('rep'));
    bd.innerHTML = h.join('');
    Array.prototype.forEach.call(bd.querySelectorAll('tr[data-r]'), function (tr) {
      var r = S.rep[+tr.getAttribute('data-r')];
      Array.prototype.forEach.call(tr.querySelectorAll('[data-k]'), function (el) { el.addEventListener('input', function () { r[el.getAttribute('data-k')] = el.value.trim(); if (el.getAttribute('data-k') === '元') { r.品名 = ''; r.ユーザー = ''; r.前回数量 = ''; } }); });
      var d = tr.querySelector('[data-del]'); if (d) d.onclick = function () { S.rep.splice(S.rep.indexOf(r), 1); リピートを描く(); };
    });
    $('fxr-add').onclick = function () { S.rep.push(空のリピート()); リピートを描く(); };
    $('fxr-take').onclick = function () {
      var 行 = $('fxr-paste').value.split(/\r?\n/).map(function (s) { return s.normalize('NFKC').trim(); }).filter(Boolean);
      S.rep = S.rep.filter(function (r) { return r.元 || r.no; });
      行.forEach(function (s) { var p = s.split(/[\s,\t]+/); var r = 空のリピート(); r.元 = p.shift() || '';
        p.forEach(function (x, j) { if (!r.数量 && /^\d+$/.test(x)) r.数量 = x; else if (!r.納期 && FM日付(x) && /[\/\-.月]/.test(x)) r.納期 = 画面日付(x); else r.メモ = (r.メモ ? r.メモ + ' ' : '') + x; });
        if (r.元) S.rep.push(r); });
      リピートを描く();
    };
    $('fxr-check').onclick = function () { 確かめる(false); };
    $('fxr-go').onclick = リピート起票;
    $('fxr-copy').onclick = function () { 写す(S.rep.filter(function (r) { return r.no; }).map(function (r) { return [r.no, r.元, r.品名, r.ユーザー, r.数量 || r.前回数量, r.納期, r.メモ].join('\t'); }).join('\n'), $('fxr-msg')); };
    校正のつなぎ('rep');
  }
  function 確かめる(続けて) {
    var 対象 = S.rep.filter(function (r) { return r.元 && !r.no; });
    var msg = function (t, k) { var m = $('fxr-msg'); if (m) { m.innerHTML = t; m.className = 'msg ' + (k || ''); } };
    if (!対象.length) { msg('元の伝票番号を入れてください'); return Promise.resolve(false); }
    var i = 0, ng = 0;
    var 次 = function () {
      if (i >= 対象.length) { リピートを描く(); msg(ng ? '<span class="err">' + ng + ' 件読めませんでした</span>' : '<span class="ok">' + 対象.length + ' 件を確かめました</span>' + (続けて ? '' : '　品名・ユーザーが合っていれば「まとめて起票」')); return Promise.resolve(!ng); }
      var r = 対象[i++]; msg('元の伝票を読んでいます… ' + i + ' / ' + 対象.length);
      return 呼ぶ('画面_読み込み', [r.元]).then(function (x) {
        if (!x || !x.record) throw new Error('見つかりません');
        var f = x.record.fields || {}; r.recordId元 = x.record.recordId; r.品名 = String(f['製品名'] || ''); r.ユーザー = String(f['ユーザー名'] || ''); r.前回数量 = String(f['ロット契約単位'] || f['合計数1'] || ''); r.元備考 = String(f['備考'] || ''); r.err = '';
      }).catch(function (e) { ng++; r.err = String(e.message || e); }).then(次);
    };
    return 次();
  }
  function リピート起票() {
    if (S.実行中) return;
    var msg = function (t, k) { var m = $('fxr-msg'); if (m) { m.innerHTML = t; m.className = 'msg ' + (k || ''); } };
    var 未確認 = S.rep.filter(function (r) { return r.元 && !r.no && !r.recordId元; });
    var p = 未確認.length ? 確かめる(true) : Promise.resolve(true);
    p.then(function (ok) {
      if (!ok) return;
      var 対象 = S.rep.filter(function (r) { return r.元 && r.recordId元 && !(r.no && r.書いた); });
      if (!対象.length) { msg('起票する行がありません'); return; }
      if (!confirm('前回と同じ内容で受注伝票を ' + 対象.length + ' 件作ります（ロット区分 リピート）。\n\n' + 対象.map(function (r) { return r.元 + '  ' + r.品名 + '  ' + (r.数量 || r.前回数量) + (r.納期 ? '  納期 ' + r.納期 : ''); }).join('\n') + '\n\nよろしいですか？')) return;
      S.実行中 = true; var i = 0, ok2 = 0, ng = 0;
      var 次 = function () {
        if (i >= 対象.length) { S.実行中 = false; リピートを描く(); msg((ng ? '<span class="err">' + ng + ' 件失敗（もう一度押すと続きから）</span>　' : '') + '<span class="ok">' + ok2 + ' 件 起票しました</span>'); return; }
        var r = 対象[i++]; r.err = ''; msg('起票しています… ' + i + ' / ' + 対象.length + '　' + esc(r.元));
        (r.no ? 読み直す(r.recordId) : 呼ぶ('画面_流用新規', [r.recordId元, '受注', true, {}]).then(function (a) { r.recordId = a.record.recordId; r.no = String(a.record.fields['伝票番号'] || a.案件ID || ''); return a.record; }))
          .then(function (rec) {
            var v = { 'ロット区分': 'リピート' }, n = 数(r.数量);
            if (n > 0) { v['ロット契約単位'] = String(n); v['注残数'] = String(n); }
            if (FM日付(r.納期)) v['納期'] = FM日付(r.納期);
            if (r.メモ) { var 旧 = String((rec.fields && rec.fields['備考']) || ''); v['備考'] = (旧 ? 旧 + '\n' : '') + r.メモ; }
            return 書く(rec, v);
          }).then(function (s) { r.書いた = true; ok2++; r.状態 = 無視の文(s); })
          .catch(function (e) { ng++; r.err = String(e.message || e); }).then(次);
      };
      次();
    });
  }

  // ================================================================ ③ 校正BOX・LINE WORKS
  function ハブ() {
    var cands = []; try { if (window.parent && window.parent !== window) cands.push(window.parent); } catch (e) {} try { if (window.opener) cands.push(window.opener); } catch (e) {}
    for (var i = 0; i < cands.length; i++) { try { if (cands[i].HubFaxBridge && cands[i].HubFaxBridge.makeCard) return cands[i].HubFaxBridge; } catch (e) {} }
    return null;
  }
  function 校正欄(kind) {
    var H = ハブ(), R = S.校正[kind];
    var h = '<div class="sec"><div class="st">4. 校正BOX・LINE WORKS へ（起票した伝票を 1 枚のカードにまとめる）</div>';
    if (!H) return h + '<div class="msg err">Hub の中で開いた受注登録からだけ使えます（Tokiwa Hub →「受注登録」のタブ）。この画面は単独で開かれています。起票した番号は「結果をコピー」で控えてください</div></div>';
    h += '<div style="font-size:12px;color:#4b5563">校正BOX にカードを 1 枚作り（伝票は全部 fmNos に）、Drive の校正フォルダの <b>01_入稿データ</b> に ' + (kind === 'fax' ? 'FAX の PDF' : '下で選んだファイル') + ' を置き、LINE WORKS のノートを作ります（本文に 伝票番号・お名前・枚数・見本No・はがき・納期）。</div>';
    if (kind === 'rep') h += '<div class="row" style="margin-top:6px"><label>入稿データ（任意）</label><input type="file" id="fxr-files" multiple></div>';
    h += '<div class="row" style="margin-top:6px"><label>件名</label><input type="text" id="fxk-title-' + kind + '" value="' + esc(校正の件名(kind)) + '" style="flex:1;min-width:320px">'
      + '<button class="btn p" id="fxk-go-' + kind + '">📸 校正BOX・LINE WORKS へ</button></div>';
    h += '<details style="margin-top:6px"><summary style="cursor:pointer;font-size:12px">ノートの本文（直せます）</summary><textarea id="fxk-body-' + kind + '" rows="8">' + esc(ノート本文(kind)) + '</textarea></details>';
    h += '<div class="msg" id="fxk-msg-' + kind + '">' + (R ? 校正の結果(R) : '') + '</div></div>';
    return h;
  }
  function 起票済み(kind) {
    if (kind === 'fax') return S.rows.filter(function (r) { return r.no && r.書いた; });
    return S.rep.filter(function (r) { return r.no && r.書いた; });
  }
  function 校正の件名(kind) {
    var rs = 起票済み(kind); if (!rs.length) return '';
    if (kind === 'fax') { var 名 = rs.map(function (r) { return r.お名前; }); var t = '年賀状印刷 ' + rs.length + '件（' + 名.slice(0, 8).join('・') + (名.length > 8 ? ' ほか' : '') + '）'; return t; }
    return rs.length === 1 ? rs[0].品名 : (rs[0].品名 + ' ほか' + (rs.length - 1) + '件');
  }
  function ノート本文(kind) {
    var rs = 起票済み(kind); if (!rs.length) return '';
    var md = function (v) { var f = FM日付(v); return f ? (+f.split('/')[0]) + '/' + (+f.split('/')[1]) : ''; };
    if (kind === 'fax') return ['北上プリント 年賀状 ' + rs.length + ' 件（FAX 受注票）'].concat(rs.map(function (r) {
      return r.no + '  ' + r.お名前 + ' 様  ' + r.枚数 + '枚  主文：' + (r.主文 || '-') + '  添文：' + (r.添文 || '-') + '  カット：' + (r.カット || '-') + '  はがき：' + r.はがき + (r.noA ? '（' + r.noA + '）' : '') + '  納期 ' + md(r.納期) + (r.メモ ? '  ※' + r.メモ : '');
    })).join('\n');
    return ['リピート（前回と同じ）' + rs.length + ' 件'].concat(rs.map(function (r) {
      return r.no + '（前回 ' + r.元 + '）  ' + r.品名 + (r.ユーザー ? '  ' + r.ユーザー : '') + '  ' + (r.数量 || r.前回数量) + (r.納期 ? '  納期 ' + md(r.納期) : '') + (r.メモ ? '  ※' + r.メモ : '');
    })).join('\n');
  }
  function 校正の結果(R) {
    var h = '';
    if (R.driveFull) h += '<div class="full">⚠ Google ドライブの容量の上限を超えています（「上限を超えています: ドライブ」）。Drive の空きを作ってから、もう一度「校正BOX・LINE WORKS へ」を押すと PDF を置けます（カードとノートはそのまま書き足し）</div>';
    h += R.id ? '<span class="ok">📸 校正BOX にカードを作りました</span> <a href="#" data-open="' + esc(R.id) + '">開く</a>' : '';
    if (R.folderUrl) h += '　📁 <a href="' + esc(R.folderUrl) + '" target="_blank">Drive フォルダ</a>';
    if (R.uploaded && R.uploaded.length) h += '　⬆ ' + esc(R.uploaded.join('、'));
    if (R.lw) h += R.lw.ok ? '　<span class="ok">💬 LINE WORKS ノート' + (R.lw.groupName ? '（' + esc(R.lw.groupName) + '）' : '') + '</span>' : '';
    if (R.errors && R.errors.length) h += '<br><span class="err">' + esc(R.errors.join('\n')) + '</span>';
    return h;
  }
  function 校正のつなぎ(kind) {
    var b = $('fxk-go-' + kind); var m = $('fxk-msg-' + kind);
    var 開く = function () { Array.prototype.forEach.call(document.querySelectorAll('#fxk-msg-' + kind + ' [data-open]'), function (a) { a.onclick = function (e) { e.preventDefault(); var H = ハブ(); if (H) H.open(a.getAttribute('data-open')); }; }); };
    開く();
    if (!b) return;
    b.onclick = function () {
      var H = ハブ(); if (!H) return;
      var rs = 起票済み(kind);
      if (!rs.length) { m.innerHTML = '<span class="err">先に起票してください（起票した伝票がありません）</span>'; return; }
      if (kind === 'fax' && S.rows.some(function (r) { return r.on && !(r.no && r.書いた); }) && !confirm('まだ起票していない（失敗した）行があります。起票した ' + rs.length + ' 件だけで校正BOX に送りますか？')) return;
      if (H.ready && !H.ready()) { m.innerHTML = '<span class="err">Hub にログインしていません。Hub 本体でログインしてから押してください</span>'; return; }
      var nos = [], items = [];
      rs.forEach(function (r) {
        if (kind === 'fax') { nos.push(r.no); items.push({ no: r.no, name: '年賀状印刷（' + r.お名前 + '）' }); if (r.noA) { nos.push(r.noA); items.push({ no: r.noA, name: '官製ハガキ（' + r.お名前 + '）' }); } }
        else { nos.push(r.no); items.push({ no: r.no, name: r.品名 + (r.ユーザー ? '（' + r.ユーザー + '）' : '') }); }
      });
      var 納期 = rs.map(function (r) { return 画面日付(r.納期); }).filter(Boolean).sort()[0] || '';
      var title = ($('fxk-title-' + kind) || {}).value || 校正の件名(kind), body = ($('fxk-body-' + kind) || {}).value || ノート本文(kind);
      b.disabled = true; m.innerHTML = 'ファイルを用意しています…';
      var files = kind === 'fax' ? (S.file ? [S.file] : []) : Array.prototype.slice.call((($('fxr-files') || {}).files) || []);
      var big = files.filter(function (f) { return f.size > 25 * 1024 * 1024; }); if (big.length) { m.innerHTML = '<span class="err">25MB を超えるファイルは置けません: ' + esc(big.map(function (f) { return f.name; }).join('、')) + '</span>'; b.disabled = false; return; }
      Promise.all(files.map(function (f, i) { return new Promise(function (res, rej) { var fr = new FileReader(); fr.onload = function () { res({ name: 名前を付ける(f, nos[0], kind, i, files.length), mime: f.type || 'application/pdf', base64: String(fr.result).split(',')[1] || '' }); }; fr.onerror = function () { rej(new Error(f.name + ' を読めません')); }; fr.readAsDataURL(f); }); }))
        .then(function (fs) {
          m.innerHTML = '校正BOX にカードを作り、Drive に置いて、LINE WORKS のノートを作っています…（数十秒かかることがあります）';
          return H.makeCard({ nos: nos, items: items, custCode: kind === 'fax' ? (型を読む(設定.型)['得意先コード'] || '') : '', custName: kind === 'fax' ? 設定.得意先名 : '', prodName: title, dueDate: 納期,
            note: (kind === 'fax' ? 'FAX 受注票（' + (S.file ? S.file.name : '') + '）から まとめて起票' : 'リピート まとめて起票') + '：' + nos.join('・'), lwComment: body, files: fs });
        })
        .then(function (R) { S.校正[kind] = R; m.innerHTML = 校正の結果(R); 開く(); b.disabled = false; b.textContent = '📸 もう一度（同じカード・ノートに書き足す）'; })
        .catch(function (e) { var t = String(e.message || e); m.innerHTML = '<span class="err">' + esc(t) + '</span>' + (上限か(t) ? '<div class="full">' + esc(上限の文(t)) + '</div>' : ''); b.disabled = false; });
    };
  }
  function 名前を付ける(f, no, kind, i, n) {
    var ext = (f.name.match(/\.([^.]+)$/) || ['', 'pdf'])[1];
    if (kind === 'fax') return no + '_' + (設定.得意先名 || '北上') + '_年賀状受注票_FAX' + (n > 1 ? '_' + (i + 1) : '') + '.' + ext;
    return no + '_' + f.name;
  }
  function 写す(text, el) {
    if (!text) { if (el) el.textContent = 'まだ起票した伝票がありません'; return; }
    var done = function () { if (el) { el.innerHTML = '<span class="ok">コピーしました（表計算に貼れます）</span>'; } };
    try { navigator.clipboard.writeText(text).then(done, function () { prompt('コピーしてください', text); }); } catch (e) { prompt('コピーしてください', text); }
  }

  // ---------------------------------------------------------------- ボタン
  function ボタンを置く() {
    if (document.getElementById('fxb-open')) return true;
    var nb = document.querySelector('.hdrow .btns button[onclick="newRec()"]'); if (!nb) return false;
    var b = document.createElement('button'); b.id = 'fxb-open'; b.className = 'fb'; b.textContent = '📠 まとめて起票';
    b.title = 'FAX の受注票（年賀状）の PDF を AI で読んで、まとめて起票 → 校正BOX・LINE WORKS へ。名刺などのリピートもまとめて';
    b.style.cssText = 'background:#0f766e !important;color:#fff !important;border-color:#0f766e !important;font-weight:700';
    b.onclick = 開く;
    var after = Array.prototype.filter.call(nb.parentNode.children, function (x) { return /AIで起票/.test(x.textContent || ''); })[0] || nb;
    after.parentNode.insertBefore(b, after.nextSibling);
    return true;
  }
  window.FMまとめて起票 = 開く;
  var n = 0, t = setInterval(function () { if (ボタンを置く() || ++n > 40) clearInterval(t); }, 250);
})();
