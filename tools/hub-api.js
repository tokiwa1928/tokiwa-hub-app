// DRIVE-P1: ツール（見積書・指示書・用紙注文書）から会社 GAS を呼ぶ窓口。
// 方針（本多さん 9/27）: Hub から出したものは人が Drive を歩かずに P番号の案件フォルダへ自動で入る。
// GAS_URL と API_KEY は Hub 本体（index.html の CLOUD_CONFIG）と同じもの。
(function () {
  var GAS_URL = 'https://script.google.com/a/macros/tokiwap-group.com/s/AKfycbw9-8Nnq3jV9lCDUEf7JOvQM_yAy1ZYnOIab-TYP3TZ-BtH7RosxKSeXmr-FvkxMVhv/exec';
  var API_KEY = 'mitsumori-2024';
  function call(action, params, post) {
    var u = new URL(GAS_URL); u.searchParams.set('action', action); u.searchParams.set('apiKey', API_KEY);
    Object.keys(params || {}).forEach(function (k) { u.searchParams.set(k, params[k]); });
    var opt = post ? { method: 'POST', body: JSON.stringify(post), redirect: 'follow' } : { method: 'GET', redirect: 'follow' };
    return fetch(u.toString(), opt).then(function (r) { return r.json(); });
  }
  // 伝票番号（か P番号）→ 案件フォルダ。無ければ found:false
  function caseFolder(denpyo, pno) { return call('caseFolderByDenpyo', {}, { denpyo: denpyo || '', pno: pno || '' }); }
  // いま画面に出ている紙を PDF にして 案件フォルダ/<sub> に入れる。html は紙の部分の HTML（style を含めて渡す）
  function savePdf(denpyo, sub, name, html, pno) {
    return caseFolder(denpyo, pno).then(function (r) {
      if (!r || !r.success) throw new Error((r && r.error) || '案件フォルダを引けません');
      if (!r.found) throw new Error('案件フォルダがまだありません。Hub の案件詳細を一度開くと自動で作られます（伝票 ' + denpyo + '）');
      var f = r.subFolders && r.subFolders[sub]; if (!f || !f.id) throw new Error('フォルダ ' + sub + ' がありません');
      return call('saveHtmlAsPdf', {}, { folderId: f.id, name: name, html: html }).then(function (x) { if (!x || !x.success) throw new Error((x && x.error) || '保存できません'); x.caseName = r.name; x.sub = sub; return x; });
    });
  }
  // 紙の HTML: ページの <style> を全部＋指定の要素
  function pageHtml(el) { var css = Array.prototype.map.call(document.querySelectorAll('style'), function (s) { return s.outerHTML; }).join('\n'); return css + (el ? el.outerHTML : document.body.innerHTML); }
  window.HubAPI = { call: call, caseFolder: caseFolder, savePdf: savePdf, pageHtml: pageHtml };
})();
