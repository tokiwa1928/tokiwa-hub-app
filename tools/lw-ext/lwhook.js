// EXT-CAT-1（本多さん 11/1「状態がノートと合っていない」）: LINE WORKS の API にはノートのカテゴリーが無いので、
//   LINE WORKS の画面が自分で読んでいる通信（fetch / XMLHttpRequest）の返事を見て、投稿 → カテゴリー を拾い、Hub（会社 GAS）へ送る。
//   ページの中で動く（content script からは見えないため）。見つけたものは window.postMessage で lw.js に渡す
(function () {
  if (window.__tokiwaHooked) return; window.__tokiwaHooked = true;
  setInterval(function () { try { window.postMessage({ tokiwaLwDiag: true, items: (window.__tokiwaDiag || []).slice(-12) }, '*'); } catch (e) { } }, 15000);
  var catKeys = ['categoryName', 'categoryTitle', 'boardName', 'folderName'], idKeys = ['categoryId', 'boardId', 'folderId'];
  function pick(o, keys) { for (var i = 0; i < keys.length; i++) { var k = keys[i]; if (o[k] != null && o[k] !== '') return o[k]; var c = o.category || o.board || o.folder; if (c && typeof c === 'object' && c[k] != null) return c[k]; } return null; }
  function scan(json, url) {
    var cats = {}, names = {}, n = 0, sample = null, seen = 0;
    (function walk(v, depth) {
      if (!v || typeof v !== 'object' || depth > 8 || seen++ > 20000) return;
      if (Array.isArray(v)) { v.forEach(function (x) { walk(x, depth + 1); }); return; }
      var pid = v.postId || v.noteId || v.postNo; var cn = pick(v, catKeys), ci = pick(v, idKeys);
      if (pid && (cn != null || ci != null)) { cats[String(pid)] = { name: cn != null ? String(cn) : '', id: ci != null ? String(ci) : '' }; n++; if (!sample) sample = Object.keys(v).join(','); }
      else if (!pid && ci != null && cn != null) names[String(ci)] = String(cn);   // カテゴリーの一覧
      Object.keys(v).forEach(function (k) { walk(v[k], depth + 1); });
    })(json, 0);
    if (n || Object.keys(names).length) window.postMessage({ tokiwaLwCats: true, url: String(url || '').slice(0, 200), cats: cats, names: names, sample: sample }, '*');
  }
  // 調べ用: 通信の URL と項目名を覚えておく（カテゴリーが拾えないとき、lw.js が Hub に送る）
  var diag = []; window.__tokiwaDiag = diag;
  function note(url, json) { try { if (diag.length >= 40) return; var top = Array.isArray(json) ? json[0] : json; var keys = top && typeof top === 'object' ? Object.keys(top).slice(0, 12).join(',') : typeof top; var inner = ''; if (top && typeof top === 'object') { for (var k in top) { var v = top[k]; if (Array.isArray(v) && v[0] && typeof v[0] === 'object') { inner = k + '[]:' + Object.keys(v[0]).slice(0, 14).join(','); break; } } } diag.push(String(url || '').replace(/^https?:\/\/[^\/]+/, '').slice(0, 80) + ' {' + keys + '} ' + inner); } catch (e) { } }
  function tryJson(text, url) { if (!text || text.length > 3000000) return; var t = text.replace(/^\)\]\}',?\s*/, ''); if (!/^[\[{]/.test(t.trim())) return; try { var j = JSON.parse(t); note(url, j); scan(j, url); } catch (e) { } }
  var of = window.fetch; if (of) window.fetch = function () { var args = arguments; return of.apply(this, args).then(function (res) { try { var u = (args[0] && args[0].url) || String(args[0] || ''); res.clone().text().then(function (t) { tryJson(t, u); }).catch(function () { }); } catch (e) { } return res; }); };
  var oo = XMLHttpRequest.prototype.open, os = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) { this.__tokiwaUrl = String(u || ''); return oo.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function () { var x = this; x.addEventListener('load', function () { try { if (x.responseType === '' || x.responseType === 'text') tryJson(x.responseText, x.__tokiwaUrl); else if (x.responseType === 'json' && x.response) { note(x.__tokiwaUrl, x.response); scan(x.response, x.__tokiwaUrl); } } catch (e) { } }); return os.apply(this, arguments); };
})();
