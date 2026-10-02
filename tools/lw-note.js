/* LWNOTE-1（本多さん 10/2「メールから LINE WORKS のグループを選んで、ノートを選んで、ファイルとコメントを入れたい」）
   問い合わせの詳細 →「💼 LW ノートへ」→ グループ → ノート → ファイルとコメント →「ノートに入れる」
   ・LINE WORKS のノートは、本人が LINE WORKS にログインして許可しないと書けない（Bot では書けない）。はじめの 1 回だけ「LINE WORKS につなぐ」
   ・ノートに「コメント」を付ける口は LINE WORKS 側に無い。選んだノートの本文の末尾に【日時 名前】で追記し、ファイルはそのノートの添付に足す
   ・中身は会社 GAS（19_lwnote.js）が送る。この画面は選ぶだけ */
(function () {
  var RECENT_KEY = 'tokiwa_lwnote_recent';
  // LWNOTE-5: 連絡の種類。選ぶと文が変わり、見出し（【2校戻り】など）がノートの本文に入る
  var STAGES = ['初校', '2校', '3校', '4校', '5校', '6校'];
  var KINDS = [
    { k: 'shikyu', label: '支給データ', text: function () { return '支給データが届きました。確認をお願いします。'; } },
    { k: 'dashi', label: '校正出し', stage: true, text: function (st) { return st + 'を出しました。確認をお願いします。'; } },
    { k: 'modori', label: '校正戻り', stage: true, text: function (st) { return st + 'の戻りです。修正をお願いします。'; } },
    { k: 'koryo', label: '校了', text: function () { return '校了です。次の工程へ進めてください。'; } },
    { k: 'sekiryo', label: '責了', text: function () { return '責了です。赤字を直して、そのまま進めてください。'; } },
    { k: 'kakunin', label: '確認・質問', text: function () { return 'お客様から確認の連絡です。内容を見て対応をお願いします。'; } },
    { k: 'other', label: 'その他', text: function () { return ''; } }
  ];
  var MAX_LOCAL = 30 * 1024 * 1024;   // PC から足すファイルの合計（会社側へ 1 回で送れる大きさの都合）
  function kindOf(k) { return KINDS.filter(function (x) { return x.k === k; })[0] || KINDS[KINDS.length - 1]; }
  function kindLabel() { var d = kindOf(S.kind); return d.k === 'other' ? '' : d.stage ? S.stage + d.label.replace('校正', '') : d.label; }
  function kindText() { return kindOf(S.kind).text(S.stage); }
  // メールの件名・本文から見立てる（決めつけない。違えば選び直す）
  function guessKind(inq, hasFiles) {
    var t = (String(inq.subject || '') + '\n' + String(inq.summary || inq.body || '').slice(0, 600)).replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); });
    var stage = /(6校|六校)/.test(t) ? '6校' : /(5校|五校)/.test(t) ? '5校' : /(4校|四校)/.test(t) ? '4校' : /(3校|三校)/.test(t) ? '3校' : /(2校|二校|再校)/.test(t) ? '2校' : '初校';
    var hasStage = /(初校|[1-6]校|[一二三四五六]校|再校)/.test(t);
    if (/責了/.test(t)) return { kind: 'sekiryo', stage: stage };
    if (/校了/.test(t)) return { kind: 'koryo', stage: stage };
    if (hasStage || /(校正|赤字|修正|訂正)/.test(t)) return { kind: 'modori', stage: stage };
    if (hasFiles && /(入稿|原稿|データ|支給)/.test(t)) return { kind: 'shikyu', stage: stage };
    return { kind: 'other', stage: stage };
  }
  // LWNOTE-7: 文と種類の食い違い。文に書いてある言葉（校了・責了・N校・戻り・出し）が、選んだ種類の見出しに入っていなければ知らせる
  function mismatch(comment, label) {
    var t = String(comment || '').replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); }).replace(/再校/g, '2校').replace(/二校/g, '2校').replace(/三校/g, '3校').replace(/1校|一校/g, '初校');
    var words = [];
    if (/責了/.test(t)) words.push('責了'); else if (/校了/.test(t)) words.push('校了');
    var m = /(初校|[2-6]校)/.exec(t); if (m) words.push(m[1]);
    if (/戻り/.test(t)) words.push('戻り'); if (/出し/.test(t) || /出しました/.test(t)) words.push('出し');
    return words.filter(function (w) { return String(label || '').indexOf(w) < 0; });
  }
  // LWNOTE-8: LINE WORKS のノートのカテゴリー（名前は LINE WORKS 側と同じにする。DB.conf.lwNoteLabels で直せる）
  var LABELS_DEFAULT = ['1-1.メディア部作業待ち（優先度高）', '1-2.メディア部作業待ち', '1-3.確認事項返信待ち', '2.校正依頼(メディア部➡営業)', '3-1.校正中(営業➡お客様)', '3-2.校正中(営業➡提携印刷会社)', '4.校了', '5.校了作業済', '5-1.校了作業済(名刺印刷待ち)', '5-2.校了作業済(封筒印刷待ち)', '5-3.校了作業済(その他印刷待ち)', '6-1.データ移動・保存済', '6-2.外注用データアップロード済', '7-1.社内印刷手配済', '7-2.外注印刷手配済', '8.印刷完了/データ納品完了'];   // LWNOTE-9: LINE WORKS のノートの「カテゴリー」と同じ名前（数字つき）
  function labels() { var c = (typeof DB !== 'undefined' && DB.conf && DB.conf.lwNoteLabels); return (Array.isArray(c) && c.length) ? c : LABELS_DEFAULT; }
  // 種類から、付けるラベルを見立てる（支給データ・校正戻り → メディア部の作業待ち／校正出し → お客様で校正中／校了・責了 → 校了）
  function labelFor(kind) {
    var L = labels(), find = function (f) { return L.filter(f)[0] || ''; };
    if (kind === 'koryo' || kind === 'sekiryo') return find(function (x) { return /(^|[.．\s])校了$/.test(x); }) || find(function (x) { return /校了/.test(x) && !/済/.test(x); }) || find(function (x) { return /校了/.test(x); });
    if (kind === 'modori' || kind === 'shikyu') return find(function (x) { return /メディア/.test(x) && /待ち/.test(x) && !/優先/.test(x); }) || find(function (x) { return /メディア/.test(x) && /待ち/.test(x); });
    if (kind === 'dashi') return find(function (x) { return /お客様/.test(x); });
    return '';
  }
  function paintLabel() {
    var w = $('lwn-lwrap'); if (!w) return;
    var chip = function (v, text) { var on = S.label === v; return '<button class="btn lwn-label" data-v="' + esc(v) + '" style="font-size:12px;padding:3px 12px;' + (on ? 'background:#15743A;color:#fff;border-color:#15743A;font-weight:700' : '') + '">' + (on ? '● ' : '') + esc(text) + '</button>'; };
    w.innerHTML = '<div style="display:flex;gap:6px;flex-wrap:wrap">' + chip('', '変えない') + labels().map(function (x) { return chip(x, x); }).join('') + '</div>'
      + '<div style="font-size:11px;color:#4A574E;margin-top:4px">' + (S.label ? '送ったあと、LINE WORKS でこのノートのカテゴリーを <b>' + esc(S.label) + '</b> に付け替えます（Hub からは変えられないので、次の画面で案内します）。' : 'カテゴリーは今のままにします。') + '　<a href="#" id="lwn-ledit" style="color:#15743A">カテゴリーの名前を直す</a></div><div id="lwn-leditbox"></div>';
    Array.prototype.forEach.call(w.querySelectorAll('.lwn-label'), function (b) { b.onclick = function () { S.label = b.dataset.v; S.labelTouched = true; paintLabel(); }; });
    $('lwn-ledit').onclick = function (ev) { ev.preventDefault();
      $('lwn-leditbox').innerHTML = '<textarea id="lwn-ltext" rows="7" style="width:100%;margin-top:6px;padding:8px;border:1px solid #D6DED2;font-size:12px;box-sizing:border-box;font-family:inherit"></textarea><div style="font-size:11px;color:#4A574E">1 行に 1 つ。LINE WORKS のカテゴリーと同じ名前・同じ順にしてください（全員に効きます）。</div><button class="btn" id="lwn-lsave" style="font-size:12px;margin-top:4px">カテゴリーの名前を保存</button>';
      $('lwn-ltext').value = labels().join('\n');
      $('lwn-lsave').onclick = function () { var list = $('lwn-ltext').value.split(/\r?\n/).map(function (x) { return x.trim(); }).filter(Boolean); if (!list.length) return; DB.conf = DB.conf || {}; DB.conf.lwNoteLabels = list; if (typeof saveDB === 'function') saveDB(); if (typeof saveToCloud === 'function') try { saveToCloud(); } catch (e) { } if (list.indexOf(S.label) < 0) S.label = S.labelTouched ? '' : labelFor(S.kind); paintLabel(); };
    };
  }
  function fmtSize(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + 'MB' : Math.max(1, Math.round(n / 1024)) + 'KB'; }
  var S = null;   // いま開いている 1 件の状態

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var ME_KEY = 'tokiwa_lwnote_me';   // LWNOTE-3: ログインにメールが無いとき（会社を選んで入る「管理者」）は、この PC で 1 回だけ聞いて覚える
  function savedMe() { try { var m = JSON.parse(localStorage.getItem(ME_KEY) || 'null'); return (m && m.email) ? m : null; } catch (e) { return null; } }
  function me() {
    var a = (typeof currentAuth !== 'undefined' && currentAuth) || {}, email = String(a.userEmail || a.email || '').toLowerCase().trim();
    if (email) return { email: email, name: a.userName || '', fixed: true };
    var m = savedMe(); return m ? { email: String(m.email).toLowerCase(), name: m.name || '', fixed: false } : { email: '', name: '', fixed: false };
  }
  function api(action, data) {
    if (typeof callCloudAPI !== 'function') return Promise.resolve({ success: false, error: 'no_cloud' });
    data = data || {}; data.email = me().email;
    return callCloudAPI(action, {}, data).then(function (r) { return r || { success: false, error: 'no_cloud' }; }, function (e) { return { success: false, error: String(e && e.message || e) }; });
  }
  function recent() { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') || []; } catch (e) { return []; } }
  function pushRecent(g) { try { var r = recent().filter(function (x) { return x.id !== g.id; }); r.unshift({ id: g.id, name: g.name }); localStorage.setItem(RECENT_KEY, JSON.stringify(r.slice(0, 8))); } catch (e) { } }
  function why(r) {
    var e = String((r && r.error) || ''), d = r && r.detail ? '（' + r.detail + '）' : '';
    if (e === 'no_cloud') return 'クラウドにつながっていません。つながってからもう一度お試しください';
    if (e === 'lw_not_configured') return 'LINE WORKS の鍵が会社側に入っていません（設定 → ✉ メール / LW 設定）';
    if (e === 'missing_email') return 'ログインしている人のメールアドレスが分かりません。入り直してください';
    if (e === 'lw_forbidden' && r.what === 'groups') return 'グループの一覧を読む許可がありません' + d + '。Developer Console の OAuth Scopes に group.read があるか確かめてください';
    if (e === 'lw_forbidden' && r.what === 'posts') return 'このグループのノートは見られません' + d + '。グループに入っているか確かめてください';
    if (e === 'lw_forbidden' && (r.what === 'write' || r.what === 'read')) return 'このノートは書いた人しか直せない設定です' + d + '。「＋ 新しいノートを作る」を選ぶか、LINE WORKS でそのノートの「メンバーの編集を許可」を入れてください';
    if (e === 'lw_forbidden') return 'LINE WORKS に断られました' + d;
    if (/^unknown_action|invalid_action/.test(e)) return '会社側の仕組みがまだ新しくなっていません';
    return 'うまくいきませんでした: ' + e + d;
  }
  function $(id) { return document.getElementById(id); }
  function close() { var m = $('lwn-modal'); if (m) m.remove(); S = null; }

  function open(inqId) {
    var inq = ((typeof DB !== 'undefined' && DB.inquiries) || []).find(function (i) { return i.id === inqId; });
    if (!inq) { alert('問い合わせが見つかりません'); return; }
    close();
    var st = null; try { if (typeof _inqActionState_ === 'function') st = _inqActionState_(inq); } catch (e) { }
    var fmNo = (st && st.fmNo) || '';
    var subj = String(inq.subject || '').replace(/^(\s*(re|fw|fwd)\s*[:：]\s*)+/i, '').trim();
    var files = (inq.attachments || []).filter(function (a) { return a && !a.expanded; }).map(function (a, i) { return { id: a.driveFileId || '', name: a.name || a.filename || ('添付' + (i + 1)), size: a.size || 0, on: !!a.driveFileId }; });
    var gk = guessKind(inq, files.length > 0);
    S = { inq: inq, fmNo: fmNo, files: files, local: [], kind: gk.kind, stage: gk.stage, autoText: '', label: labelFor(gk.kind), labelTouched: false, groups: [], group: null, posts: [], nextCursor: '', postId: '', newTitle: ((fmNo ? fmNo + ' ' : '') + (st && st.proj ? (st.proj.item || st.proj.prod || subj) : subj)).slice(0, 190), busy: false };
    var m = document.createElement('div'); m.id = 'lwn-modal'; m.className = 'proof-modal';
    m.style.cssText = 'position:fixed;inset:0;z-index:10050;background:rgba(23,33,26,.45);display:flex;align-items:center;justify-content:center';
    m.innerHTML = '<style>#lwn-modal input[type=radio],#lwn-modal input[type=checkbox]{width:auto!important;min-width:0!important;min-height:0!important;flex:none!important;margin:0}#lwn-modal label{font-weight:400}</style>'
      + '<div style="background:#fff;width:720px;max-width:96vw;max-height:92vh;display:flex;flex-direction:column;border:1px solid #2E3D35">'
      + '<div style="padding:12px 16px;background:#2E3D35;color:#fff;display:flex;justify-content:space-between;align-items:center"><div style="font-weight:700;font-size:15px">💼 LINE WORKS のノートへ入れる</div><button id="lwn-x" style="background:none;border:0;color:#fff;font-size:20px;cursor:pointer;line-height:1" title="閉じる">×</button></div>'
      + '<div style="padding:8px 16px;background:#F4F7F3;border-bottom:1px solid #D6DED2;font-size:12px;color:#4A574E">メール: <b style="color:#17211A">' + esc(subj || '（件名なし）') + '</b>　' + esc(inq.from_company || '') + ' ' + esc(inq.from_name || '') + '</div>'
      + '<div id="lwn-body" style="padding:14px 16px;overflow:auto;font-size:13px;color:#17211A;line-height:1.7">読み込み中…</div>'
      + '<div id="lwn-foot" style="padding:10px 16px;border-top:1px solid #D6DED2;display:flex;gap:8px;justify-content:flex-end;align-items:center"></div></div>';
    document.body.appendChild(m);
    $('lwn-x').onclick = close;
    m.addEventListener('mousedown', function (ev) { if (ev.target === m && !(S && S.busy)) close(); });
    if (!me().email) showWho(); else start();
  }
  function start() { $('lwn-body').innerHTML = '読み込み中…'; $('lwn-foot').innerHTML = ''; api('lwNoteStatus').then(function (r) { if (!S) return; if (r.success && r.connected) loadGroups(); else if (r.success) showConnect(); else showMsg(why(r)); }); }

  // LWNOTE-3: 書く人を聞く（ログインにメールアドレスが無いとき）
  function showWho() {
    var m = savedMe() || {};
    $('lwn-body').innerHTML = '<div style="padding:6px 2px"><div style="font-weight:700;font-size:14px">ノートに書く人を教えてください（この PC で 1 回だけ）</div>'
      + '<div style="margin-top:6px;color:#4A574E">いまのログインにはメールアドレスが無いので、誰の LINE WORKS で書くかが分かりません。ご自分の名前と、LINE WORKS のメールアドレスを入れてください。</div>'
      + '<div style="margin-top:12px;display:grid;grid-template-columns:90px 1fr;gap:8px;align-items:center;max-width:460px">'
      + '<span>名前</span><input id="lwn-who-name" value="' + esc(m.name || '') + '" placeholder="例: 本多" style="padding:6px 8px;border:1px solid #D6DED2;font-size:13px">'
      + '<span>メール</span><input id="lwn-who-mail" value="' + esc(m.email || '') + '" placeholder="例: honda@tokiwap.co.jp" style="padding:6px 8px;border:1px solid #D6DED2;font-size:13px"></div>'
      + '<div id="lwn-who-msg" style="margin-top:8px;font-size:12px;color:#B42318"></div></div>';
    $('lwn-foot').innerHTML = '<button class="btn" id="lwn-close">やめる</button><button class="btn btn-p" id="lwn-who-ok" style="font-weight:700">次へ</button>';
    $('lwn-close').onclick = close;
    $('lwn-who-ok').onclick = function () {
      var name = $('lwn-who-name').value.trim(), mail = $('lwn-who-mail').value.trim().toLowerCase();
      if (!name) { $('lwn-who-msg').textContent = '名前を入れてください'; return; }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) { $('lwn-who-msg').textContent = 'メールアドレスの形になっていません'; return; }
      try { localStorage.setItem(ME_KEY, JSON.stringify({ name: name, email: mail })); } catch (e) { }
      start();
    };
  }

  function showMsg(msg, withRetry) {
    $('lwn-body').innerHTML = '<div style="padding:18px 4px;color:#B42318">' + esc(msg) + '</div>';
    $('lwn-foot').innerHTML = (withRetry ? '<button class="btn" id="lwn-retry">もう一度</button>' : '') + '<button class="btn" id="lwn-close">閉じる</button>';
    $('lwn-close').onclick = close; if (withRetry) $('lwn-retry').onclick = loadGroups;
  }

  // はじめの 1 回: 本人が LINE WORKS にログインして許可する
  function showConnect(note) {
    $('lwn-body').innerHTML = '<div style="padding:6px 2px">'
      + (note ? '<div style="color:#B42318;margin-bottom:8px">' + esc(note) + '</div>' : '')
      + '<div style="font-weight:700;font-size:14px">はじめに、LINE WORKS とつなぎます（1 回だけ）</div>'
      + '<div style="margin-top:6px;color:#4A574E">ノートは「誰が書いたか」が残るので、ご自分の LINE WORKS でログインして許可します。<br>下のボタンで別のタブが開きます。ログインして「許可」を押し、「つながりました」と出たら、このタブに戻って「つないだ → 続ける」を押してください。</div>'
      + '<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-p" id="lwn-connect" style="font-weight:700">LINE WORKS につなぐ</button><button class="btn" id="lwn-continue">つないだ → 続ける</button></div>'
      + '<div id="lwn-cmsg" style="margin-top:8px;font-size:12px;color:#4A574E"></div></div>';
    $('lwn-foot').innerHTML = '<button class="btn" id="lwn-close">閉じる</button>'; $('lwn-close').onclick = close;
    $('lwn-connect').onclick = function () {
      var w = window.open('about:blank', '_blank');   // 押した瞬間に開く（あとから開くと止められる）
      $('lwn-cmsg').textContent = 'ログイン画面を用意しています…';
      api('lwNoteAuthUrl').then(function (r) {
        if (r.success && r.url) { if (w) w.location.href = r.url; else window.open(r.url, '_blank'); $('lwn-cmsg').textContent = '別のタブで LINE WORKS にログインして許可してください。'; }
        else { if (w) w.close(); $('lwn-cmsg').textContent = why(r); }
      });
    };
    $('lwn-continue').onclick = function () {
      $('lwn-cmsg').textContent = '確かめています…';
      api('lwNoteStatus').then(function (r) { if (!S) return; if (r.success && r.connected) loadGroups(); else $('lwn-cmsg').textContent = r.success ? 'まだつながっていません。別のタブで「つながりました」と出るまで進めてください。' : why(r); });
    };
  }

  function loadGroups(fresh) {
    $('lwn-body').innerHTML = 'グループを読んでいます…'; $('lwn-foot').innerHTML = '';
    api('lwNoteGroups', fresh === true ? { fresh: 1 } : {}).then(function (r) {
      if (!S) return;
      if (!r.success) { if (r.error === 'lw_not_connected') showConnect('つなぎ直しが要ります（しばらく使っていないと切れます）'); else showMsg(why(r), true); return; }
      S.groups = r.groups || []; renderMain();
    });
  }

  function renderMain() {
    $('lwn-body').innerHTML =
      sec('① グループ', '<input id="lwn-gq" placeholder="グループ名で絞る" style="width:100%;padding:6px 8px;border:1px solid #D6DED2;font-size:13px;box-sizing:border-box">'
        + '<div id="lwn-glist" style="margin-top:6px;border:1px solid #D6DED2;max-height:150px;overflow:auto"></div>'
        + '<div style="margin-top:4px;font-size:11px;color:#4A574E">' + S.groups.length + ' グループ　<a href="#" id="lwn-greload" style="color:#15743A">読み直す</a></div>')
      + sec('② ノート', '<div id="lwn-pwrap" style="color:#4A574E">先にグループを選んでください</div>')
      + sec('③ ファイル', '<div id="lwn-fwrap"></div><input type="file" id="lwn-add" multiple style="display:none">')
      + sec('④ 連絡の種類と文', '<div id="lwn-kwrap"></div>'
        + '<textarea id="lwn-comment" rows="4" placeholder="ノートに書き足す文（空でも入れられます）" style="width:100%;padding:8px;border:1px solid #D6DED2;font-size:13px;box-sizing:border-box;font-family:inherit"></textarea>'
        + '<div style="font-size:11px;color:#4A574E;margin-top:2px">書く人: <b>' + esc(me().name) + '</b>（' + esc(me().email) + '）' + (me().fixed ? '' : '　<a href="#" id="lwn-who-change" style="color:#15743A">変える</a>') + '<br>ノートの本文の末尾に <b id="lwn-head"></b> を付けて書き足します。メールの件名と差出人、入れたファイル名も添えます。</div>')
      + sec('⑤ ノートのカテゴリー（LINE WORKS 側）', '<div id="lwn-lwrap"></div>');
    $('lwn-foot').innerHTML = '<span id="lwn-msg" style="margin-right:auto;font-size:12px;color:#B42318"></span><button class="btn" id="lwn-cancel">やめる</button><button class="btn btn-p" id="lwn-go" style="font-weight:700;min-width:140px">ノートに入れる</button>';
    $('lwn-cancel').onclick = close; $('lwn-go').onclick = go;
    if ($('lwn-who-change')) $('lwn-who-change').onclick = function (ev) { ev.preventDefault(); showWho(); };
    $('lwn-gq').oninput = paintGroups; $('lwn-greload').onclick = function (ev) { ev.preventDefault(); loadGroups(true); };
    $('lwn-add').onchange = function () { addLocal(this.files); this.value = ''; };
    var body = $('lwn-body');   // ファイルをドラッグして足す
    body.ondragover = function (ev) { if (ev.dataTransfer && Array.prototype.indexOf.call(ev.dataTransfer.types || [], 'Files') >= 0) { ev.preventDefault(); body.style.outline = '2px dashed #15743A'; } };
    body.ondragleave = function () { body.style.outline = ''; };
    body.ondrop = function (ev) { body.style.outline = ''; if (ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files.length) { ev.preventDefault(); addLocal(ev.dataTransfer.files); } };
    $('lwn-comment').value = S.autoText = kindText();
    paintFiles(); paintKind(); paintLabel(); paintGroups();
  }
  // ③ メールの添付（Drive にあるもの）＋ PC から足したもの
  function paintFiles() {
    var total = S.local.reduce(function (n, f) { return n + f.size; }, 0);
    $('lwn-fwrap').innerHTML = (S.files.length ? S.files.map(function (f, i) {
      return '<label style="display:flex;gap:8px;align-items:center;padding:3px 0;' + (f.id ? 'cursor:pointer' : 'color:#9aa59d') + '"><input type="checkbox" class="lwn-file" data-i="' + i + '"' + (f.id ? (f.on ? ' checked' : '') : ' disabled') + '> <span>' + esc(f.name) + '</span>' + (f.id ? '' : '<span style="font-size:11px">（Drive に無いので入れられません）</span>') + '</label>';
    }).join('') : '<div style="color:#4A574E">このメールに添付はありません</div>')
      + S.local.map(function (f, i) { return '<div style="display:flex;gap:8px;align-items:center;padding:3px 0"><span style="color:#15743A">＋</span><span>' + esc(f.name) + '</span><span style="font-size:11px;color:#4A574E">' + fmtSize(f.size) + '</span><a href="#" class="lwn-ldel" data-i="' + i + '" style="color:#B42318;font-size:12px">外す</a></div>'; }).join('')
      + '<div style="margin-top:6px;display:flex;gap:10px;align-items:center;flex-wrap:wrap"><button class="btn" id="lwn-addbtn" style="font-size:12px;padding:3px 12px">＋ PC のファイルを足す</button><span style="font-size:11px;color:#4A574E">ここにドラッグしても足せます（合計 30MB まで' + (S.local.length ? '・いま ' + fmtSize(total) : '') + '）</span></div>';
    $('lwn-addbtn').onclick = function () { $('lwn-add').click(); };
    Array.prototype.forEach.call(document.querySelectorAll('.lwn-file'), function (c) { c.onchange = function () { var f = S.files[+c.dataset.i]; if (f) f.on = c.checked; }; });
    Array.prototype.forEach.call(document.querySelectorAll('.lwn-ldel'), function (a) { a.onclick = function (ev) { ev.preventDefault(); S.local.splice(+a.dataset.i, 1); paintFiles(); }; });
  }
  function addLocal(list) {
    var msg = $('lwn-msg'); if (msg) { msg.style.color = '#B42318'; msg.textContent = ''; }
    Array.prototype.forEach.call(list || [], function (f) {
      if (!f || !f.size) return;
      if (S.local.some(function (x) { return x.name === f.name && x.size === f.size; })) return;
      var total = S.local.reduce(function (n, x) { return n + x.size; }, 0);
      if (total + f.size > MAX_LOCAL) { if (msg) msg.textContent = '「' + f.name + '」は足せません（PC から足せるのは合計 30MB まで）'; return; }
      S.local.push(f);
    });
    paintFiles();
  }
  // ④ 連絡の種類。選ぶと文が変わる（手で直した文は消さない）
  function paintKind() {
    var d = kindOf(S.kind);
    var chip = function (cls, key, label, on) { return '<button class="btn ' + cls + '" data-k="' + esc(key) + '" style="font-size:12px;padding:3px 12px;' + (on ? 'background:#15743A;color:#fff;border-color:#15743A;font-weight:700' : '') + '">' + esc(label) + '</button>'; };
    $('lwn-kwrap').innerHTML = '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px">' + KINDS.map(function (x) { return chip('lwn-kind', x.k, x.label, x.k === S.kind); }).join('') + '</div>'
      + (d.stage ? '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;align-items:center"><span style="font-size:12px;color:#4A574E">何校:</span>' + STAGES.map(function (st) { return chip('lwn-stage', st, st, st === S.stage); }).join('') + '</div>' : '');
    var pick = function () {
      var t = $('lwn-comment'), cur = t.value.trim();
      if (!cur || cur === S.autoText.trim()) t.value = kindText();   // 手で直していなければ、選んだ種類の文に入れ替える
      S.autoText = kindText(); if (!S.labelTouched) S.label = labelFor(S.kind); paintKind(); paintLabel();   // LWNOTE-8: 手で選んでいなければ、種類に合わせてラベルも変える
    };
    Array.prototype.forEach.call(document.querySelectorAll('.lwn-kind'), function (b) { b.onclick = function () { S.kind = b.dataset.k; pick(); }; });
    Array.prototype.forEach.call(document.querySelectorAll('.lwn-stage'), function (b) { b.onclick = function () { S.stage = b.dataset.k; pick(); }; });
    var lb = kindLabel(); if ($('lwn-head')) $('lwn-head').textContent = '【日時 ' + me().name + '】' + (lb ? '【' + lb + '】' : '');
  }
  function readB64(f) { return new Promise(function (res, rej) { var fr = new FileReader(); fr.onload = function () { var v = String(fr.result || ''); res(v.slice(v.indexOf(',') + 1)); }; fr.onerror = function () { rej(new Error('読めません')); }; fr.readAsDataURL(f); }); }
  function sec(title, inner) { return '<div style="margin-bottom:14px"><div style="font-weight:700;font-size:13px;color:#2E3D35;margin-bottom:5px">' + title + '</div>' + inner + '</div>'; }

  function paintGroups() {
    var q = String(($('lwn-gq') || {}).value || '').trim().toLowerCase();
    var rec = recent().filter(function (r) { return S.groups.some(function (g) { return g.id === r.id; }); });
    var recIds = rec.map(function (r) { return r.id; });
    var list = (q ? [] : rec.map(function (r) { return { id: r.id, name: r.name, rec: true }; })).concat(S.groups.filter(function (g) { return q ? g.name.toLowerCase().indexOf(q) >= 0 : recIds.indexOf(g.id) < 0; }));
    $('lwn-glist').innerHTML = list.length ? list.map(function (g) {
      var on = S.group && S.group.id === g.id;
      return '<div class="lwn-g" data-id="' + esc(g.id) + '" style="padding:5px 10px;cursor:pointer;border-bottom:1px solid #EEF2EC;' + (on ? 'background:#15743A;color:#fff;font-weight:700' : '') + '">' + esc(g.name) + (g.rec ? '<span style="font-size:11px;opacity:.7">　最近使った</span>' : '') + '</div>';
    }).join('') : '<div style="padding:8px 10px;color:#4A574E">当てはまるグループがありません</div>';
    Array.prototype.forEach.call(document.querySelectorAll('.lwn-g'), function (el) {
      el.onclick = function () { var g = S.groups.filter(function (x) { return x.id === el.dataset.id; })[0]; if (!g) return; S.group = g; S.posts = []; S.nextCursor = ''; S.postId = ''; paintGroups(); loadPosts(false); };
    });
  }

  function loadPosts(more) {
    var gid = S.group.id;
    if (!more) $('lwn-pwrap').innerHTML = 'ノートを読んでいます…';
    api('lwNotePosts', more ? { groupId: gid, cursor: S.nextCursor } : { groupId: gid }).then(function (r) {
      if (!S || !S.group || S.group.id !== gid) return;
      if (!r.success) { if (r.error === 'lw_not_connected') { showConnect('つなぎ直しが要ります'); return; } $('lwn-pwrap').innerHTML = '<span style="color:#B42318">' + esc(why(r)) + '</span>'; return; }
      S.posts = (more ? S.posts : []).concat(r.posts || []); S.nextCursor = r.nextCursor || '';
      if (!more && !S.postId) {   // 伝票番号が題に入っているノートがあれば、はじめから選ぶ
        var hit = S.fmNo ? S.posts.filter(function (p) { return String(p.title).indexOf(S.fmNo) >= 0; })[0] : null;
        S.postId = hit ? String(hit.postId) : 'new';
      }
      paintPosts();
    });
  }
  function paintPosts() {
    var q = String(($('lwn-pq') || {}).value || '');
    var ql = q.trim().toLowerCase();
    var rows = S.posts.filter(function (p) { return !ql || String(p.title).toLowerCase().indexOf(ql) >= 0; });
    var row = function (id, inner, on) { return '<label style="display:flex;gap:8px;align-items:flex-start;padding:5px 10px;cursor:pointer;border-bottom:1px solid #EEF2EC;' + (on ? 'background:#E3F1E6' : '') + '"><input type="radio" name="lwn-post" value="' + esc(id) + '"' + (on ? ' checked' : '') + ' style="margin-top:4px"> <span style="flex:1">' + inner + '</span></label>'; };
    $('lwn-pwrap').innerHTML = '<input id="lwn-pq" placeholder="ノートの題で絞る" value="' + esc(q) + '" style="width:100%;padding:6px 8px;border:1px solid #D6DED2;font-size:13px;box-sizing:border-box">'
      + '<div style="margin-top:6px;border:1px solid #D6DED2;max-height:190px;overflow:auto">'
      + row('new', '<b>＋ 新しいノートを作る</b>' + (S.postId === 'new' ? '<br><input id="lwn-title" value="' + esc(S.newTitle) + '" maxlength="190" placeholder="ノートの題" style="width:100%;margin-top:4px;padding:5px 8px;border:1px solid #D6DED2;font-size:13px;box-sizing:border-box">' : ''), S.postId === 'new')
      + rows.map(function (p) { return row(String(p.postId), esc(p.title) + '<br><span style="font-size:11px;color:#4A574E">' + esc(String(p.modified).slice(0, 10)) + '　' + esc(p.by) + (p.files ? '　📎' + p.files : '') + (p.collab ? '' : '　※書いた人だけ編集可') + '</span>', S.postId === String(p.postId)); }).join('')
      + (S.nextCursor ? '<div style="padding:6px 10px"><a href="#" id="lwn-more" style="color:#15743A">もっと前のノートを読む</a></div>' : '')
      + '</div>';
    $('lwn-pq').oninput = function () { var pos = this.selectionStart; paintPosts(); var n = $('lwn-pq'); n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) { } };
    Array.prototype.forEach.call(document.querySelectorAll('input[name="lwn-post"]'), function (el) { el.onchange = function () { keepTitle(); S.postId = el.value; paintPosts(); }; });
    if ($('lwn-title')) $('lwn-title').oninput = keepTitle;
    if ($('lwn-more')) $('lwn-more').onclick = function (ev) { ev.preventDefault(); this.textContent = '読んでいます…'; loadPosts(true); };
  }
  function keepTitle() { if ($('lwn-title')) S.newTitle = $('lwn-title').value; }

  function go() {
    if (S.busy) return;
    keepTitle();
    var msg = $('lwn-msg'), isNew = S.postId === 'new';
    if (!S.group) { msg.textContent = '① グループを選んでください'; return; }
    if (!S.postId) { msg.textContent = '② ノートを選んでください'; return; }
    if (isNew && !S.newTitle.trim()) { msg.textContent = '新しいノートの題を入れてください'; return; }
    var ids = [], names = [];
    S.files.forEach(function (f) { if (f.on && f.id) { ids.push(f.id); names.push(f.name); } });
    var comment = $('lwn-comment').value.trim(), kind = kindLabel(), local = S.local.slice();
    if (!ids.length && !local.length && !comment && !kind) { msg.style.color = '#B42318'; msg.textContent = 'ファイルか文のどちらかを入れてください'; return; }
    var label = S.label || '';
    var bad = mismatch(comment, kind);   // LWNOTE-7
    if (bad.length && !confirm('文に「' + bad.join('」「') + '」とありますが、選んだ種類は「' + (kind || 'その他') + '」です。\n\nこのまま送りますか？\n（種類を直すときは「キャンセル」を押して、④ で選び直してください）')) { msg.style.color = '#B42318'; msg.textContent = '④ の種類を確かめてください'; return; }
    var post = isNew ? null : S.posts.filter(function (p) { return String(p.postId) === S.postId; })[0];
    var title = isNew ? S.newTitle.trim() : (post ? post.title : '');
    S.busy = true; msg.style.color = '#4A574E'; msg.textContent = 'LINE WORKS へ送っています…（ファイルが大きいと 1〜2 分かかります）';
    $('lwn-go').disabled = true; $('lwn-cancel').disabled = true;
    var inq = S.inq, group = S.group, postId = isNew ? '' : S.postId;
    Promise.all(local.map(function (f) { return readB64(f).then(function (b64) { return { name: f.name, type: f.type || '', b64: b64 }; }); })).then(function (uploads) {
      return api('lwNoteInsert', { groupId: group.id, postId: postId, title: title, kind: kind, label: label, comment: comment, by: me().name, fileIds: ids, uploads: uploads, mailSubject: String(inq.subject || ''), mailFrom: [inq.from_company, inq.from_name].filter(Boolean).join(' ') });
    }, function () { return { success: false, error: 'PC のファイルを読めませんでした' }; }).then(function (r) {
      if (!S) return; S.busy = false;
      if (!r.success) {
        if (r.error === 'lw_not_connected') { showConnect('つなぎ直しが要ります'); return; }
        msg.style.color = '#B42318'; msg.textContent = why(r); $('lwn-go').disabled = false; $('lwn-cancel').disabled = false; return;
      }
      pushRecent(group);
      var ok = (r.files || []).filter(function (f) { return f.ok; }), ng = (r.files || []).filter(function (f) { return !f.ok; });
      try {
        if (typeof _inqPushTimeline_ === 'function') _inqPushTimeline_(inq, { type: 'lw_note', at: new Date().toISOString(), by: me().name || 'user', group: group.name, note: title,
          text: 'LINE WORKS のノート「' + title + '」（' + group.name + '）に入れた' + (kind ? '【' + kind + '】' : '') + (ok.length ? '・ファイル ' + ok.length + ' 件' : '') + (comment ? '・コメント' : '') + (ng.length ? '（入らなかったファイル ' + ng.length + ' 件）' : '') });
      } catch (e) { }
      var needLabel = !!label;   // LWNOTE-7・8: ラベルは LINE WORKS 側でしか変えられない → 変えるまで閉じない
      $('lwn-body').innerHTML = '<div style="padding:8px 2px"><div style="font-weight:700;font-size:15px;color:#15743A">ノートに入れました</div>'
        + (needLabel ? '<div style="margin-top:10px;padding:12px 14px;background:#FFF4D6;border:2px solid #E0A100;line-height:1.7"><div style="font-weight:700;font-size:15px;color:#7A4B00">つぎに、LINE WORKS でこのノートのカテゴリーを変えてください</div><div style="font-size:14px;margin-top:4px">付け替えるカテゴリー: <b style="font-size:17px">' + esc(label) + '</b>' + (kind ? '　<span style="font-size:12px;color:#4A574E">（今回の連絡: ' + esc(kind) + '）</span>' : '') + '</div><div style="font-size:12px;color:#4A574E;margin-top:4px">カテゴリーは Hub からは変えられません（LINE WORKS が外から変える口を出していないため）。LINE WORKS でノート「' + esc(title) + '」を開いて「修正」→ 上の「カテゴリー」で選び直して「投稿」。</div></div>' : '')
        + '<div style="margin-top:6px">' + (kind ? '<b>【' + esc(kind) + '】</b> ' : '') + esc(group.name) + ' ／ ' + esc(title) + (r.created ? '（新しく作りました）' : '（本文の末尾に書き足しました）') + '</div>'
        + (ok.length ? '<div style="margin-top:8px">添付したファイル: ' + ok.map(function (f) { return esc(f.name); }).join('、') + '</div>' : '')
        + (ng.length ? '<div style="margin-top:8px;color:#B42318">入らなかったファイル:<br>' + ng.map(function (f) { return '・' + esc(f.name) + ' … ' + esc(f.why); }).join('<br>') + '</div>' : '') + '</div>';
      $('lwn-foot').innerHTML = (needLabel ? '<button class="btn" id="lwn-later" style="margin-right:auto;font-size:12px">あとで変える</button>' : '') + '<button class="btn btn-p" id="lwn-close" style="font-weight:700">' + (needLabel ? 'カテゴリーを変えた → 閉じる' : '閉じる') + '</button>';
      if (needLabel) { S.busy = true; $('lwn-later').onclick = function () { try { if (typeof _inqPushTimeline_ === 'function') _inqPushTimeline_(inq, { type: 'lw_label_later', at: new Date().toISOString(), by: me().name || 'user', text: '⚠ LINE WORKS のノートのカテゴリーをまだ変えていない（' + label + '）' }); } catch (e) { } $('lwn-close').onclick(); }; }
      $('lwn-close').onclick = function () { var id = inq.id; S.busy = false; close(); try { if (typeof openInquiryDetail === 'function' && document.querySelector('#inq-detail-panel.show')) openInquiryDetail(id); } catch (e) { } };
      if (typeof _toastMsg === 'function') _toastMsg('💼 LINE WORKS のノートに入れました');
    });
  }

  window.lwNoteOpen = open;
})();
