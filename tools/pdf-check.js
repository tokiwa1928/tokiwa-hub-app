// PDFCHECK-1（11/11 本多さん「解像度と裁ち落としが正しいかも調べるツールに。作るときに一緒に調べられるように」）
//   pdf.js で開いた PDF を、ブラウザの中だけで調べる（どこにも送らない）。面付チェック（menzuke-check.html）と折丁面付台（oricho-menzuke.html）が使う。
//   PdfCheck.解像度(doc, {pages, 進む}) … 置かれている画像ごとに 実効解像度（ppi）＝ 画像の画素 ÷ 置いた大きさ（インチ）
//   PdfCheck.塗り足し(doc, 枠たち, {pages, 進む}) … 仕上がり線（枠）の外側 3mm に絵柄が続いているか。端まで絵柄があるのに外が白なら「塗り足し不足」
//   PdfCheck.原稿の塗り足し(doc, 仕上がり, {進む}) … 単ページの原稿で、ページの大きさが 仕上がり＋塗り足し になっているか、端の絵柄が切れていないか
(function () {
  var MM = 72 / 25.4;
  function 掛ける(m, n) { return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]]; }
  function ページ番号たち(doc, o) { var n = doc.numPages, ps = (o && o.pages) || null; if (ps) return ps.filter(function (p) { return p >= 1 && p <= n; }); var a = []; for (var i = 1; i <= n; i++) a.push(i); return a; }

  /** 画像ごとの実効解像度。返す: [{page, w, h, 幅mm, 高さmm, ppi, x, y}]（x,y はページ左上からの pt） */
  function 解像度(doc, o) {
    o = o || {}; var OPS = pdfjsLib.OPS, out = [], ps = ページ番号たち(doc, o), i = 0;
    function next() {
      if (i >= ps.length) return Promise.resolve(out);
      var pn = ps[i++];
      return doc.getPage(pn).then(function (pg) {
        var H = pg.view[3] - pg.view[1];
        return pg.getOperatorList().then(function (ol) {
          var ctm = [1, 0, 0, 1, 0, 0], stack = [];
          for (var k = 0; k < ol.fnArray.length; k++) {
            var fn = ol.fnArray[k], a = ol.argsArray[k];
            if (fn === OPS.save) stack.push(ctm.slice());
            else if (fn === OPS.restore) { if (stack.length) ctm = stack.pop(); }
            else if (fn === OPS.transform) ctm = 掛ける(ctm, a);
            else if (fn === OPS.paintFormXObjectBegin) { stack.push(ctm.slice()); if (a && a[0]) ctm = 掛ける(ctm, a[0]); }
            else if (fn === OPS.paintFormXObjectEnd) { if (stack.length) ctm = stack.pop(); }
            else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageXObjectRepeat) {
              var w, h;
              if (fn === OPS.paintInlineImageXObject) { w = a[0] && a[0].width; h = a[0] && a[0].height; }
              else { w = a[1]; h = a[2]; }
              if (!w || !h) continue;
              var pw = Math.hypot(ctm[0], ctm[1]), ph = Math.hypot(ctm[2], ctm[3]);
              if (pw < 2 || ph < 2) continue;   // 1pt 未満の飾りは数えない
              var ppi = Math.min(w / (pw / 72), h / (ph / 72));
              out.push({ page: pn, w: w, h: h, 幅mm: pw / MM, 高さmm: ph / MM, ppi: Math.round(ppi), x: ctm[4], y: H - ctm[5] - ph });
            }
          }
          pg.cleanup(); if (o.進む) o.進む(i, ps.length);
          return next();
        });
      });
    }
    return next();
  }

  /** ページを小さく描いて、色のある画素を数える道具 */
  function 描く(pg, dpi) {
    var vp = pg.getViewport({ scale: dpi / 72 }), c = document.createElement('canvas');
    c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
    var x = c.getContext('2d', { willReadFrequently: true }); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
    return pg.render({ canvasContext: x, viewport: vp }).promise.then(function () { return { c: c, x: x, s: dpi / 72, data: x.getImageData(0, 0, c.width, c.height).data, W: c.width, H: c.height }; });
  }
  /** 四角（pt・左上基準）の中で、白でない画素の割合 */
  function 色の割合(img, x0, y0, x1, y1) {
    var s = img.s, X0 = Math.max(0, Math.floor(Math.min(x0, x1) * s)), X1 = Math.min(img.W, Math.ceil(Math.max(x0, x1) * s)), Y0 = Math.max(0, Math.floor(Math.min(y0, y1) * s)), Y1 = Math.min(img.H, Math.ceil(Math.max(y0, y1) * s));
    var n = 0, hit = 0;
    for (var y = Y0; y < Y1; y++) for (var x = X0; x < X1; x++) { var i = (y * img.W + x) * 4; n++; if (img.data[i] < 235 || img.data[i + 1] < 235 || img.data[i + 2] < 235) hit++; }
    return n ? hit / n : 0;
  }
  /** 1 つの枠の 1 辺を調べる。辺の中ほど 80% を、内側 0.3〜1.2mm と 外側 1.5〜2.6mm で比べる */
  function 辺(img, r, 辺名) {
    var a = 0.3 * MM, b = 1.2 * MM, c = 1.5 * MM, d = 2.6 * MM, x0 = r.x, y0 = r.y, x1 = r.x + r.w, y1 = r.y + r.h, mx = r.w * 0.1, my = r.h * 0.1;
    var 内, 外;
    if (辺名 === '上') { 内 = 色の割合(img, x0 + mx, y0 + a, x1 - mx, y0 + b); 外 = 色の割合(img, x0 + mx, y0 - d, x1 - mx, y0 - c); }
    else if (辺名 === '下') { 内 = 色の割合(img, x0 + mx, y1 - b, x1 - mx, y1 - a); 外 = 色の割合(img, x0 + mx, y1 + c, x1 - mx, y1 + d); }
    else if (辺名 === '左') { 内 = 色の割合(img, x0 + a, y0 + my, x0 + b, y1 - my); 外 = 色の割合(img, x0 - d, y0 + my, x0 - c, y1 - my); }
    else { 内 = 色の割合(img, x1 - b, y0 + my, x1 - a, y1 - my); 外 = 色の割合(img, x1 + c, y0 + my, x1 + d, y1 - my); }
    var 判定 = 内 < 0.08 ? '端に絵柄なし' : (外 >= 内 * 0.5 ? 'OK' : '不足');
    return { 辺: 辺名, 内: Math.round(内 * 100), 外: Math.round(外 * 100), 判定: 判定 };
  }
  /** 面付済みの面で、枠（仕上がり）ごとの塗り足しを調べる。枠たち: [{名, x, y, w, h, 辺: ['上','下','左','右']}]（pt・左上基準。辺は 塗り足しが要る外側の辺だけ） */
  function 塗り足し(doc, 枠たち, o) {
    o = o || {}; var ps = ページ番号たち(doc, o), out = [], i = 0;
    function next() {
      if (i >= ps.length) return Promise.resolve(out);
      var pn = ps[i++];
      return doc.getPage(pn).then(function (pg) { return 描く(pg, o.dpi || 40).then(function (img) {
        枠たち.forEach(function (r) { (r.辺 || ['上', '下', '左', '右']).forEach(function (e) { var v = 辺(img, r, e); if (v.判定 === '不足') out.push({ page: pn, 枠: r.名, 辺: e, 内: v.内, 外: v.外 }); }); });
        pg.cleanup(); if (o.進む) o.進む(i, ps.length); return next();
      }); });
    }
    return next();
  }
  /** 単ページの原稿。仕上がり {w,h}（mm）。返す: { 大きさ: 'OK'|'塗り足しなし'|'大きさ違い', ページmm, 塗り足しmm, 不足: [{page, 辺}] } */
  function 原稿の塗り足し(doc, 仕上がり, o) {
    o = o || {};
    return doc.getPage(1).then(function (pg) {
      var W = (pg.view[2] - pg.view[0]) / MM, H = (pg.view[3] - pg.view[1]) / MM;
      var 回 = Math.abs(W - 仕上がり.h) < Math.abs(W - 仕上がり.w) && Math.abs(H - 仕上がり.w) < Math.abs(H - 仕上がり.h);
      var fw = 回 ? 仕上がり.h : 仕上がり.w, fh = 回 ? 仕上がり.w : 仕上がり.h;
      var bx = (W - fw) / 2, by = (H - fh) / 2, 結果 = { ページmm: { w: W, h: H }, 塗り足しmm: Math.min(bx, by), 大きさ: '', 不足: [] };
      if (bx < -0.5 || by < -0.5) 結果.大きさ = '大きさ違い'; else if (bx < 1 && by < 1) 結果.大きさ = '塗り足しなし'; else if (bx < 2.5 || by < 2.5) 結果.大きさ = '塗り足しが細い'; else 結果.大きさ = 'OK';
      // 塗り足しのある原稿: 仕上がり線の外 3mm に絵柄が続いているか（ページを全部見る）。塗り足しのない原稿: 端に絵柄があるページを数える
      var ps = ページ番号たち(doc, o), i = 0;
      function next() {
        if (i >= ps.length) return 結果;
        var pn = ps[i++];
        return doc.getPage(pn).then(function (p2) { return 描く(p2, o.dpi || 50).then(function (img) {
          if (結果.大きさ === 'OK' || 結果.大きさ === '塗り足しが細い') {
            var r = { x: bx * MM, y: by * MM, w: fw * MM, h: fh * MM };
            ['上', '下', '左', '右'].forEach(function (e) { var v = 辺(img, r, e); if (v.判定 === '不足') 結果.不足.push({ page: pn, 辺: e }); });
          } else if (結果.大きさ === '塗り足しなし') {
            var r2 = { x: 0, y: 0, w: W * MM, h: H * MM };
            ['上', '下', '左', '右'].forEach(function (e) { var a = 0.2 * MM, b = 1.0 * MM, v;
              if (e === '上') v = 色の割合(img, r2.w * 0.1, a, r2.w * 0.9, b); else if (e === '下') v = 色の割合(img, r2.w * 0.1, r2.h - b, r2.w * 0.9, r2.h - a);
              else if (e === '左') v = 色の割合(img, a, r2.h * 0.1, b, r2.h * 0.9); else v = 色の割合(img, r2.w - b, r2.h * 0.1, r2.w - a, r2.h * 0.9);
              if (v >= 0.08) 結果.不足.push({ page: pn, 辺: e }); });
          }
          p2.cleanup(); if (o.進む) o.進む(i, ps.length); return next();
        }); });
      }
      return next();
    });
  }
  /** 解像度の結果をまとめる（同じ画像サイズ・同じ置き方は 1 つに） */
  function 解像度のまとめ(list, 目安) {
    目安 = 目安 || { 低: 200, 注意: 300 };
    var 低 = list.filter(function (x) { return x.ppi < 目安.低; }), 注意 = list.filter(function (x) { return x.ppi >= 目安.低 && x.ppi < 目安.注意; });
    var 最小 = list.reduce(function (m, x) { return Math.min(m, x.ppi); }, Infinity);
    return { 画像数: list.length, 低: 低, 注意: 注意, 最小: list.length ? 最小 : null };
  }
  window.PdfCheck = { 解像度: 解像度, 解像度のまとめ: 解像度のまとめ, 塗り足し: 塗り足し, 原稿の塗り足し: 原稿の塗り足し, MM: MM };
})();
