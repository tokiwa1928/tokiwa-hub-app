// Tokiwa Hub の側: 「拡張機能が入っている」印を付ける（Hub はこれを見て、カテゴリーを自動で付け替える案内に切り替える）
(function () {
  try {
    var v = (chrome && chrome.runtime && chrome.runtime.getManifest) ? chrome.runtime.getManifest().version : '1';
    document.documentElement.setAttribute('data-tokiwa-lw-ext', v);
  } catch (e) { document.documentElement.setAttribute('data-tokiwa-lw-ext', '1'); }
})();
