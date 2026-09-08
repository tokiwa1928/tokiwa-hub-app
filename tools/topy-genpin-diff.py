# -*- coding: utf-8 -*-
"""
トピー現品票 原稿比較シート生成
  前月と今月の原稿PDFから「識別帯（品名・略番・棚番）」を切り出し、
  左右に並べたHTMLを作る。版下変更の有無は人が見て判断し、
  チェックした結果をCSVに落として作業リストへ取り込む。

  使い方:
    python topy-genpin-diff.py <前月PDF> <今月PDF> [出力フォルダ]
  例:
    python topy-genpin-diff.py 8月分.pdf 9月分.pdf C:\\genpin_compare
"""
import sys, os, io, base64
import pymupdf
from PIL import Image

BAND = (0.03, 0.42)      # ページ上部から識別帯として切り出す縦位置
BAND_W = 0.72            # 同 横幅
THUMB_W = 430            # 一覧に出す帯の幅(px)


def bands(path, dpi=150):
    """各ページの識別帯と全体サムネイルを base64 で返す"""
    doc = pymupdf.open(path)
    out = []
    for i in range(len(doc)):
        pm = doc[i].get_pixmap(dpi=dpi)
        im = Image.open(io.BytesIO(pm.tobytes('png'))).convert('RGB')
        w, h = im.size
        band = im.crop((0, int(h * BAND[0]), int(w * BAND_W), int(h * BAND[1])))
        band = band.resize((THUMB_W, int(band.size[1] * THUMB_W / band.size[0])), Image.LANCZOS)
        full = im.resize((360, int(h * 360 / w)), Image.LANCZOS)
        out.append({'page': i + 1, 'band': b64(band, 72), 'full': b64(full, 60)})
    return out


def b64(im, q):
    buf = io.BytesIO()
    im.save(buf, 'JPEG', quality=q, optimize=True)
    return base64.b64encode(buf.getvalue()).decode('ascii')


def build(prev_pdf, cur_pdf, outdir):
    os.makedirs(outdir, exist_ok=True)
    prev = bands(prev_pdf)
    cur = bands(cur_pdf)
    html = HTML.replace('__PREVN__', str(len(prev))).replace('__CURN__', str(len(cur)))
    html = html.replace('__PREVFILE__', esc(os.path.basename(prev_pdf)))
    html = html.replace('__CURFILE__', esc(os.path.basename(cur_pdf)))

    # 今月（左）
    left = []
    for c in cur:
        left.append(
            '<div class="item" data-page="%d">'
            '<div class="ph">今月 P%d</div>'
            '<img class="band" src="data:image/jpeg;base64,%s">'
            '<div class="ctl">'
            '<label>前月P <input class="pair" type="number" min="1" max="%d" placeholder="—"></label>'
            '<label class="chk"><input type="checkbox" class="mod"> 版下修正あり</label>'
            '<input class="code" placeholder="棚番（例 M-45）">'
            '</div>'
            '<details><summary>全体を見る</summary>'
            '<img class="full" src="data:image/jpeg;base64,%s"></details>'
            '</div>' % (c['page'], c['page'], c['band'], len(prev), c['full']))

    # 前月（右・参照用）
    right = []
    for p in prev:
        right.append(
            '<div class="item ref" id="prev%d">'
            '<div class="ph">前月 P%d</div>'
            '<img class="band" src="data:image/jpeg;base64,%s">'
            '<details><summary>全体を見る</summary>'
            '<img class="full" src="data:image/jpeg;base64,%s"></details>'
            '</div>' % (p['page'], p['page'], p['band'], p['full']))

    html = html.replace('__LEFT__', '\n'.join(left)).replace('__RIGHT__', '\n'.join(right))
    f = os.path.join(outdir, '原稿比較シート.html')
    with open(f, 'w', encoding='utf-8') as fp:
        fp.write(html)
    print('作成しました: %s' % f)
    print('  今月 %d ページ / 前月 %d ページ' % (len(cur), len(prev)))
    return f


def esc(s):
    return (s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;'))


HTML = u"""<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>トピー現品票 原稿比較シート</title>
<style>
 body{margin:0;font-family:'Yu Gothic','Meiryo',sans-serif;background:#f7f6f3;color:#1a1a1a;font-size:13px}
 header{background:#1a1a1a;color:#fff;padding:9px 14px;position:sticky;top:0;z-index:5}
 header b{font-size:14px} header span{font-size:11.5px;color:#cbd5e1;margin-left:10px}
 .bar{background:#fff;border-bottom:1px solid #e5e3dc;padding:7px 14px;position:sticky;top:36px;z-index:4;display:flex;gap:9px;align-items:center;flex-wrap:wrap}
 .btn{border:1px solid #c9c6bf;background:#fff;border-radius:6px;padding:5px 13px;cursor:pointer;font-family:inherit;font-size:12.5px}
 .btn.p{background:#1a1a1a;color:#fff;border-color:#1a1a1a;font-weight:700}
 .wrap{display:grid;grid-template-columns:1fr 1fr;gap:14px;padding:12px 14px 60px;align-items:start}
 .col h2{font-size:13px;margin:0 0 8px;position:sticky;top:78px;background:#f7f6f3;padding:4px 0;z-index:3}
 .item{background:#fff;border:1px solid #e5e3dc;border-radius:8px;padding:7px 8px;margin-bottom:9px}
 .item.done{border-color:#86efac;background:#f0fdf4}
 .item.mod{border-color:#fca5a5;background:#fef2f2}
 .ph{font-size:11px;color:#64748b;font-weight:700;margin-bottom:3px}
 img.band{width:100%;display:block;border:1px solid #e5e3dc;border-radius:4px}
 img.full{width:100%;margin-top:6px;border:1px solid #e5e3dc;border-radius:4px}
 .ctl{display:flex;gap:9px;align-items:center;flex-wrap:wrap;margin-top:5px;font-size:12px}
 .ctl input[type=number]{width:62px;padding:3px 5px;border:1px solid #c9c6bf;border-radius:5px}
 .ctl .code{flex:1;min-width:110px;padding:3px 6px;border:1px solid #c9c6bf;border-radius:5px;font-family:inherit}
 .chk{white-space:nowrap}
 details summary{font-size:11px;color:#64748b;cursor:pointer;margin-top:4px}
 .hint{background:#fff;border:1px solid #e5e3dc;border-radius:8px;padding:9px 12px;margin:12px 14px 0;font-size:12px;line-height:1.8;color:#334155}
</style></head><body>
<header><b>🏷 トピー現品票 原稿比較シート</b><span>今月 __CURFILE__（__CURN__ページ） ／ 前月 __PREVFILE__（__PREVN__ページ）</span></header>
<div class="bar">
  <button class="btn p" onclick="dl()">チェック結果をCSVで保存</button>
  <button class="btn" onclick="jump()">未入力へ移動</button>
  <span id="st" style="font-size:12px;color:#64748b"></span>
</div>
<div class="hint">
  左が<b>今月</b>、右が<b>前月</b>です。今月の各ページについて、右から同じ棚番のものを探し、<b>前月P</b> にその番号を入れます。<br>
  原稿の中身が変わっていれば <b>版下修正あり</b> にチェック。前月に見当たらなければ前月Pは空のまま（＝新規）。<br>
  <b>棚番</b>（例 <code>M-45</code>）を入れておくと、作業リストと突き合わせやすくなります。「全体を見る」で原稿全体を確認できます。
</div>
<div class="wrap">
  <div class="col"><h2>今月（__CURN__ページ）</h2>__LEFT__</div>
  <div class="col"><h2>前月（__PREVN__ページ・参照用）</h2>__RIGHT__</div>
</div>
<script>
function items(){ return [].slice.call(document.querySelectorAll('.item:not(.ref)')); }
function upd(){
  var n=0, m=0;
  items().forEach(function(it){
    var p=it.querySelector('.pair').value.trim();
    var mod=it.querySelector('.mod').checked;
    it.classList.toggle('mod', mod);
    it.classList.toggle('done', !!p && !mod);
    if(p||mod) n++;
    if(mod) m++;
  });
  document.getElementById('st').textContent='入力済 '+n+' / '+items().length+'　版下修正あり '+m+'件';
}
document.addEventListener('input', upd);
document.addEventListener('change', upd);
function jump(){
  var t=items().filter(function(it){ return !it.querySelector('.pair').value.trim() && !it.querySelector('.mod').checked; })[0];
  if(t) t.scrollIntoView({block:'center'}); else alert('すべて入力済みです');
}
function dl(){
  var rows=[['今月ページ','棚番','前月ページ','版下変更','ロット区分の目安']];
  items().forEach(function(it){
    var p=it.querySelector('.pair').value.trim();
    var mod=it.querySelector('.mod').checked;
    rows.push([ it.dataset.page, it.querySelector('.code').value.trim(), p,
                (mod?'有':'無'), (p? 'リピート':'新規') ]);
  });
  var csv='\\ufeff'+rows.map(function(r){ return r.map(function(v){ return '"'+String(v).replace(/"/g,'""')+'"'; }).join(','); }).join('\\r\\n');
  var a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
  a.download='原稿比較_'+new Date().toISOString().slice(0,10)+'.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}
upd();
</script></body></html>
"""

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    build(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else '.')
