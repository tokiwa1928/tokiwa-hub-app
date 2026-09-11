/**
 * GEN の記録（保管庫）をこの PC に写して、本体の画面に並べるための入れ物。
 *
 *   本体の保存先（localStorage と全社クラウド）は 5MB ほどしか入らないので、
 *   GEN の過去の記録（入金 4,000・支払 3,000・発注 12,000…）はそこには入れず、
 *   ブラウザの IndexedDB に写しておき、画面を開くときに本体の一覧へ混ぜる（_archived:true）。
 *   混ぜた行を直したときだけ、その行は本体の保存に乗る（tools/gen-archive.js と index.html の _genArchive* を参照）。
 *
 *   元は Drive の保管庫（GEN_入金・GEN_支払・GEN_発注・GEN_受入）。24 時間たったら、サインインしていれば自動で取り直す。
 */
(function () {
  var DBN = 'tokiwa_gen_archive', STORE = 'rows', 有効時間 = 24 * 60 * 60 * 1000;
  var 画面 = ['入金', '支払', '発注', '受入'];

  function 開く() {
    return new Promise(function (res, rej) {
      var q = indexedDB.open(DBN, 1);
      q.onupgradeneeded = function () { q.result.createObjectStore(STORE, { keyPath: '画面' }); };
      q.onsuccess = function () { res(q.result); };
      q.onerror = function () { rej(q.error); };
    });
  }
  function 読む(db, name) {
    return new Promise(function (res, rej) {
      var r = db.transaction(STORE).objectStore(STORE).get(name);
      r.onsuccess = function () { res(r.result || null); }; r.onerror = function () { rej(r.error); };
    });
  }
  function 書く(db, o) {
    return new Promise(function (res, rej) {
      var r = db.transaction(STORE, 'readwrite').objectStore(STORE).put(o);
      r.onsuccess = function () { res(); }; r.onerror = function () { rej(r.error); };
    });
  }

  var G = {
    data: {},          // 画面 → 行（保管庫の列名のまま）
    更新: {},          // 画面 → ISO
    忙しい: false,
    /** IndexedDB から読んで onReady(data)。古ければ保管庫から取り直してもう一度 onReady */
    準備: function (onReady) {
      if (!window.indexedDB) return Promise.resolve();
      return 開く().then(function (db) {
        return Promise.all(画面.map(function (n) { return 読む(db, n); })).then(function (rs) {
          rs.forEach(function (o, i) { if (o) { G.data[画面[i]] = o.行 || []; G.更新[画面[i]] = o.更新; } });
          try { if (onReady) onReady(G.data); } catch (e) { console.warn('[gen-archive] onReady', e); }
          var 古い = 画面.some(function (n) { return !G.更新[n] || (Date.now() - new Date(G.更新[n]).getTime()) > 有効時間; });
          if (古い) return G.取り直す(onReady);
        });
      }).catch(function (e) { console.warn('[gen-archive] 準備', e); });
    },
    /** 保管庫（GEN_一覧）から全部取り直す。サインインしていなければ何もしない */
    取り直す: function (onReady) {
      if (G.忙しい) return Promise.resolve();
      if (!window.FM || !FM.名乗っている || !FM.名乗っている()) return Promise.resolve();
      G.忙しい = true;
      var t0 = Date.now();
      return 開く().then(function (db) {
        var p = Promise.resolve();
        画面.forEach(function (n) {
          p = p.then(function () { return FM.呼ぶ('GEN_一覧', [n, null, 0]); })
               .then(function (r) { G.data[n] = r.行 || []; G.更新[n] = new Date().toISOString(); return 書く(db, { 画面: n, 行: G.data[n], 更新: G.更新[n] }); });
        });
        return p.then(function () {
          console.log('[gen-archive] 取り直し ' + Math.round((Date.now() - t0) / 1000) + '秒', 画面.map(function (n) { return n + ' ' + (G.data[n] || []).length; }).join('・'));
          try { if (onReady) onReady(G.data); } catch (e) { console.warn('[gen-archive] onReady', e); }
        });
      }).catch(function (e) { console.warn('[gen-archive] 取り直す', e); })
        .then(function () { G.忙しい = false; });
    },
    件数: function () { var o = {}; 画面.forEach(function (n) { o[n] = (G.data[n] || []).length; }); return o; }
  };
  window.GENARC = G;
})();
