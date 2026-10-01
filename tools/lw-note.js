/* LWNOTE-1（本多さん 10/2「メールから LINE WORKS のグループを選んで、ノートを選んで、ファイルとコメントを入れたい」）
   問い合わせの詳細 →「💼 LW ノートへ」→ グループ → ノート → ファイルとコメント →「ノートに入れる」
   ・LINE WORKS のノートは、本人が LINE WORKS にログインして許可しないと書けない（Bot では書けない）。はじめの 1 回だけ「LINE WORKS につなぐ」
   ・ノートに「コメント」を付ける口は LINE WORKS 側に無い。選んだノートの本文の末尾に【日時 名前】で追記し、ファイルはそのノートの添付に足す
   ・中身は会社 GAS（19_lwnote.js）が送る。この画面は選ぶだけ */
(function () {
  var RECENT_KEY = 'tokiwa_lwnote_recent';
  var CANNED = ['支給データです', '校正戻りです。修正お願いします', '確認お願いします', '校了です'];
  var S = null;   // いま開いている 1 件の状態

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function me() { var a = (typeof currentAuth !== 'undefined' && currentAuth) || {}; return { email: String(a.userEmail || a.email || '').toLowerCase(), name: a.userName || '' }; }
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
    if (!me().email) { alert('ログインしている人のメールアドレスが分かりません。入り直してください'); return; }
    close();
    var st = null; try { if (typeof _inqActionState_ === 'function') st = _inqActionState_(inq); } catch (e) { }
    var fmNo = (st && st.fmNo) || '';
    var subj = String(inq.subject || '').replace(/^(\s*(re|fw|fwd)\s*[:：]\s*)+/i, '').trim();
    var files = (inq.attachments || []).filter(function (a) { return a && !a.expanded; }).map(function (a, i) { return { id: a.driveFileId || '', name: a.name || a.filename || ('添付' + (i + 1)), size: a.size || 0 }; });
    S = { inq: inq, fmNo: fmNo, files: files, groups: [], group: null, posts: [], nextCursor: '', postId: '', newTitle: ((fmNo ? fmNo + ' ' : '') + (st && st.proj ? (st.proj.item || st.proj.prod || subj) : subj)).slice(0, 190), busy: false };
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
    api('lwNoteStatus').then(function (r) { if (!S) return; if (r.success && r.connected) loadGroups(); else if (r.success) showConnect(); else showMsg(why(r)); });
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
    var fileRows = S.files.length ? S.files.map(function (f, i) {
      return '<label style="display:flex;gap:8px;align-items:center;padding:3px 0;' + (f.id ? 'cursor:pointer' : 'color:#9aa59d') + '"><input type="checkbox" class="lwn-file" data-i="' + i + '"' + (f.id ? ' checked' : ' disabled') + '> <span>' + esc(f.name) + '</span>' + (f.id ? '' : '<span style="font-size:11px">（Drive に無いので入れられません）</span>') + '</label>';
    }).join('') : '<div style="color:#4A574E">このメールに添付はありません（コメントだけ入れられます）</div>';
    $('lwn-body').innerHTML =
      sec('① グループ', '<input id="lwn-gq" placeholder="グループ名で絞る" style="width:100%;padding:6px 8px;border:1px solid #D6DED2;font-size:13px;box-sizing:border-box">'
        + '<div id="lwn-glist" style="margin-top:6px;border:1px solid #D6DED2;max-height:150px;overflow:auto"></div>'
        + '<div style="margin-top:4px;font-size:11px;color:#4A574E">' + S.groups.length + ' グループ　<a href="#" id="lwn-greload" style="color:#15743A">読み直す</a></div>')
      + sec('② ノート', '<div id="lwn-pwrap" style="color:#4A574E">先にグループを選んでください</div>')
      + sec('③ ファイル', fileRows)
      + sec('④ コメント', '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px">' + CANNED.map(function (c, i) { return '<button class="btn lwn-canned" data-i="' + i + '" style="font-size:12px;padding:2px 10px">' + esc(c) + '</button>'; }).join('') + '</div>'
        + '<textarea id="lwn-comment" rows="4" placeholder="ノートに書き足す文（空でも入れられます）" style="width:100%;padding:8px;border:1px solid #D6DED2;font-size:13px;box-sizing:border-box;font-family:inherit"></textarea>'
        + '<div style="font-size:11px;color:#4A574E;margin-top:2px">ノートの本文の末尾に【日時 ' + esc(me().name) + '】を付けて書き足します。メールの件名と差出人、入れたファイル名も添えます。</div>');
    $('lwn-foot').innerHTML = '<span id="lwn-msg" style="margin-right:auto;font-size:12px;color:#B42318"></span><button class="btn" id="lwn-cancel">やめる</button><button class="btn btn-p" id="lwn-go" style="font-weight:700;min-width:140px">ノートに入れる</button>';
    $('lwn-cancel').onclick = close; $('lwn-go').onclick = go;
    $('lwn-gq').oninput = paintGroups; $('lwn-greload').onclick = function (ev) { ev.preventDefault(); loadGroups(true); };
    Array.prototype.forEach.call(document.querySelectorAll('.lwn-canned'), function (b) { b.onclick = function () { var t = $('lwn-comment'); t.value = (t.value ? t.value.replace(/\s*$/, '') + '\n' : '') + CANNED[+b.dataset.i]; t.focus(); }; });
    paintGroups();
  }
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
    Array.prototype.forEach.call(document.querySelectorAll('.lwn-file'), function (c) { var f = S.files[+c.dataset.i]; if (c.checked && f && f.id) { ids.push(f.id); names.push(f.name); } });
    var comment = $('lwn-comment').value.trim();
    if (!ids.length && !comment) { msg.textContent = 'ファイルかコメントのどちらかを入れてください'; return; }
    var post = isNew ? null : S.posts.filter(function (p) { return String(p.postId) === S.postId; })[0];
    var title = isNew ? S.newTitle.trim() : (post ? post.title : '');
    S.busy = true; msg.style.color = '#4A574E'; msg.textContent = 'LINE WORKS へ送っています…（ファイルが大きいと 1〜2 分かかります）';
    $('lwn-go').disabled = true; $('lwn-cancel').disabled = true;
    var inq = S.inq, group = S.group;
    api('lwNoteInsert', { groupId: group.id, postId: isNew ? '' : S.postId, title: title, comment: comment, by: me().name, fileIds: ids, mailSubject: String(inq.subject || ''), mailFrom: [inq.from_company, inq.from_name].filter(Boolean).join(' ') }).then(function (r) {
      if (!S) return; S.busy = false;
      if (!r.success) {
        if (r.error === 'lw_not_connected') { showConnect('つなぎ直しが要ります'); return; }
        msg.style.color = '#B42318'; msg.textContent = why(r); $('lwn-go').disabled = false; $('lwn-cancel').disabled = false; return;
      }
      pushRecent(group);
      var ok = (r.files || []).filter(function (f) { return f.ok; }), ng = (r.files || []).filter(function (f) { return !f.ok; });
      try {
        if (typeof _inqPushTimeline_ === 'function') _inqPushTimeline_(inq, { type: 'lw_note', at: new Date().toISOString(), by: me().name || 'user', group: group.name, note: title,
          text: 'LINE WORKS のノート「' + title + '」（' + group.name + '）に入れた' + (ok.length ? '・ファイル ' + ok.length + ' 件' : '') + (comment ? '・コメント' : '') + (ng.length ? '（入らなかったファイル ' + ng.length + ' 件）' : '') });
      } catch (e) { }
      $('lwn-body').innerHTML = '<div style="padding:8px 2px"><div style="font-weight:700;font-size:15px;color:#15743A">ノートに入れました</div>'
        + '<div style="margin-top:6px">' + esc(group.name) + ' ／ ' + esc(title) + (r.created ? '（新しく作りました）' : '（本文の末尾に書き足しました）') + '</div>'
        + (ok.length ? '<div style="margin-top:8px">添付したファイル: ' + ok.map(function (f) { return esc(f.name); }).join('、') + '</div>' : '')
        + (ng.length ? '<div style="margin-top:8px;color:#B42318">入らなかったファイル:<br>' + ng.map(function (f) { return '・' + esc(f.name) + ' … ' + esc(f.why); }).join('<br>') + '</div>' : '') + '</div>';
      $('lwn-foot').innerHTML = '<button class="btn btn-p" id="lwn-close">閉じる</button>'; $('lwn-close').onclick = function () { var id = inq.id; close(); try { if (typeof openInquiryDetail === 'function' && document.querySelector('#inq-detail-panel.show')) openInquiryDetail(id); } catch (e) { } };
      if (typeof _toastMsg === 'function') _toastMsg('💼 LINE WORKS のノートに入れました');
    });
  }

  window.lwNoteOpen = open;
})();
