# -*- coding: utf-8 -*-
r"""過去の見積書（Excel）を読んで、見積実績の JSON にする。
   置き場所: G:\共有ドライブ\トキワ印刷株式会社_業務\30_営業\00_見積書 以下の *.xlsx / *.xlsm / *.xls
   書式が会社ごとに違うので、決め打ちではなく「数量・単価・金額の見出し行」を探して読む。
   出力: C:\gdrive-migration\mitsumori_scan\見積実績_YYYYMMDD.json（1 行 = 見積 1 件、明細つき）と 読めなかった一覧.txt

   使い方: python mitsumori_scan.py [ルート] [--limit N]
"""
import os, sys, re, json, io, glob, datetime, argparse, traceback
if __name__ == '__main__':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

ROOT_DEFAULT = r'G:\共有ドライブ\トキワ印刷株式会社_業務\30_営業\00_見積書'
OUT_DIR = r'C:\gdrive-migration\mitsumori_scan'

def norm(s):
    if s is None: return ''
    s = str(s).replace('\u3000', ' ').strip()
    return s

def zen2han(s):
    return norm(s).translate(str.maketrans('０１２３４５６７８９－．，（）', '0123456789-.,()'))

def to_num(v):
    if v is None or v == '': return None
    if isinstance(v, (int, float)): return float(v)
    t = zen2han(v).replace(',', '').replace('円', '').replace('¥', '').replace('￥', '').strip()
    m = re.match(r'^-?\d+(\.\d+)?$', t)
    return float(t) if m else None

def find_date(cells, fname):
    for (r, c, v) in cells:
        if isinstance(v, (datetime.datetime, datetime.date)) and 2000 <= v.year <= 2100:
            return v.strftime('%Y-%m-%d')
    for (r, c, v) in cells:
        t = zen2han(v)
        m = re.search(r'(20\d\d)[/.年-]\s*(\d{1,2})[/.月-]\s*(\d{1,2})', t)
        if m: return '%s-%02d-%02d' % (m.group(1), int(m.group(2)), int(m.group(3)))
        m = re.search(r'令和\s*(\d{1,2}|元)\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日', t)
        if m: y = 2018 + (1 if m.group(1) == '元' else int(m.group(1))); return '%d-%02d-%02d' % (y, int(m.group(2)), int(m.group(3)))
    for (r, c, v) in cells:
        t = zen2han(v)
        m = re.search(r'(?<!\d)(\d{1,2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日', t)
        if m and r <= 14:
            y = int(m.group(1)); y = (1988 + y) if y >= 20 else (2018 + y)   # 20〜31 → 平成、1〜19 → 令和
            return '%d-%02d-%02d' % (y, int(m.group(2)), int(m.group(3)))
    b = os.path.basename(fname)
    m = re.search(r'(20\d\d)(\d\d)(\d\d)', b)
    if m: return '%s-%s-%s' % m.groups()
    m = re.match(r'(\d\d)(\d\d)(\d\d)\D', b)
    if m and 1 <= int(m.group(2)) <= 12 and 1 <= int(m.group(3)) <= 31: return '20%s-%s-%s' % m.groups()
    return ''

def find_customer(cells, fname):
    for (r, c, v) in cells:
        t = norm(v)
        if r <= 14 and re.search(r'(様|御中)\s*$', t) and len(t) < 60 and t not in ('様', '御中'):
            return re.sub(r'\s*(様|御中)\s*$', '', t)
    # 「様」だけのセル → 同じ行で左にある一番近い文字
    for (r, c, v) in cells:
        if r <= 14 and norm(v) in ('様', '御中'):
            left = [(cc, vv) for (rr2, cc, vv) in cells if rr2 == r and cc < c and norm(vv) and norm(vv) not in ('様', '御中')]
            if left: return norm(left[-1][1])
    m = re.search(r'_([^_\\/]+?)(様|御中)_', os.path.basename(fname))
    if m: return m.group(1)
    return ''

def find_issuer(cells):
    for (r, c, v) in cells:
        t = norm(v)
        if r <= 12 and re.search(r'(印刷|プリント|アート・エス|ソネ商事)', t) and re.search(r'(株式会社|有限会社|㈱|㈲)', t) and len(t) < 40 and not re.search(r'(様|御中)', t):
            return t
    return ''

def read_workbook(path):
    """(見出し付きセル一覧, 表の行) を返す。xlsx は openpyxl、xls は xlrd"""
    cells = []
    ext = os.path.splitext(path)[1].lower()
    rows = []
    if ext in ('.xlsx', '.xlsm'):
        import openpyxl
        wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
        ws = None
        for name in wb.sheetnames:
            if name in ('提出', 'Sheet1', '見積書', '御見積書'): ws = wb[name]; break
        if ws is None: ws = wb[wb.sheetnames[0]]
        for row in ws.iter_rows(min_row=1, max_row=80, max_col=20):
            rr = []
            for cell in row:
                v = cell.value
                rr.append(v)
                if v not in (None, ''): cells.append((cell.row, cell.column, v))
            rows.append(rr)
    elif ext == '.xls':
        import xlrd
        wb = xlrd.open_workbook(path)
        ws = wb.sheet_by_index(0)
        for r in range(min(ws.nrows, 80)):
            rr = []
            for c in range(min(ws.ncols, 20)):
                cell = ws.cell(r, c); v = cell.value
                if cell.ctype == 3:
                    try: v = datetime.datetime(*xlrd.xldate_as_tuple(v, wb.datemode))
                    except Exception: pass
                rr.append(v)
                if v not in (None, ''): cells.append((r + 1, c + 1, v))
            rows.append(rr)
    else:
        raise ValueError('対象外の拡張子')
    return cells, rows

def squash(s):
    return re.sub(r'[\s\u3000]+', '', norm(s))

def find_header(rows):
    """「数量」と「単価」を含む見出し行と、各列の位置（空白入りの見出しにも当たる）"""
    for i, rr in enumerate(rows):
        labels = [squash(v) for v in rr]
        if any('数量' in l for l in labels) and any('単価' in l for l in labels):
            col = {}
            for j, l in enumerate(labels):
                if not l: continue
                if '数量' in l and 'qty' not in col: col['qty'] = j
                elif '単価' in l and 'price' not in col: col['price'] = j
                elif ('金額' in l or '税抜' in l) and 'amt' not in col: col['amt'] = j
                elif '単位' in l and 'unit' not in col: col['unit'] = j
                elif ('項目' in l or '品名' in l or '内容' in l or '摘要' in l or '品目' in l) and 'name' not in col: col['name'] = j
            if 'name' not in col:
                # 見出しの左側で最初の文字列列
                for j, l in enumerate(labels):
                    if l and j < col.get('qty', 99) and not re.match(r'^(No\.?|№|#)$', l, re.I): col['name'] = j; break
            return i, col
    return -1, {}

def parse_file(path):
    cells, rows = read_workbook(path)
    hi, col = find_header(rows)
    out = { 'file': path, 'date': find_date(cells, path), 'customer': find_customer(cells, path), 'issuer': find_issuer(cells), 'items': [], 'total': None, 'subject': '' }
    m = re.search(r'見積書_(.+?)\.(xlsx|xlsm|xls)$', os.path.basename(path))
    if m: out['subject'] = m.group(1)
    if hi < 0: out['error'] = '数量・単価の見出しが見つからない'; return out
    last_name = ''
    for rr in rows[hi + 1:hi + 40]:
        def g(k):
            j = col.get(k); return rr[j] if j is not None and j < len(rr) else None
        name = norm(g('name')); qty = to_num(g('qty')); price = to_num(g('price')); amt = to_num(g('amt')); unit = norm(g('unit'))
        if name and re.match(r'^(計|小計|消費税|合計)', name): break
        if not (qty or price or amt): continue
        if name and name not in ('〃', '"', '同上'): last_name = name
        else: name = ''
        out['items'].append({ 'name': name or last_name, 'qty': qty, 'unit': unit, 'price': price, 'amount': amt if amt is not None else ((qty or 0) * (price or 0) or None) })
    # 合計: 「合計」の見出しの右にある数
    for i, rr in enumerate(rows):
        for j, v in enumerate(rr):
            if re.search(r'^(合計|合計金額|御見積金額|お見積金額|AMOUNT.*合計金額)', squash(v), re.I) and not re.search(r'税抜|税込|小計', squash(v)):
                for k in range(j + 1, min(j + 8, len(rr))):
                    n = to_num(rr[k])
                    if n: out['total'] = n; break
                if out['total'] is None and i + 1 < len(rows):
                    for k in range(0, len(rows[i + 1])):
                        n = to_num(rows[i + 1][k]);
                        if n and n > 100: out['total'] = n; break
            if out['total'] is not None: break
        if out['total'] is not None: break
    if not out['items']: out['error'] = '明細が読めない'
    return out

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('root', nargs='?', default=ROOT_DEFAULT); ap.add_argument('--limit', type=int, default=0)
    a = ap.parse_args()
    os.makedirs(OUT_DIR, exist_ok=True)
    stamp = datetime.datetime.now().strftime('%Y%m%d')
    outp = os.path.join(OUT_DIR, '見積実績_%s.json' % stamp); badp = os.path.join(OUT_DIR, '読めなかった一覧_%s.txt' % stamp); logp = os.path.join(OUT_DIR, 'scan_%s.log' % stamp)
    files = []
    for dp, dn, fn in os.walk(a.root):
        dn[:] = [d for d in dn if not d.startswith('~') and d.lower() != 'old' and d != 'trashbox']
        for f in fn:
            if f.startswith('~$') or f.startswith('.'): continue
            if os.path.splitext(f)[1].lower() in ('.xlsx', '.xlsm', '.xls') and re.search(r'見積|mitsumori|予算', f): files.append(os.path.join(dp, f))
    if a.limit: files = files[:a.limit]
    print('対象', len(files), '件'); results = []; bad = []
    with open(logp, 'w', encoding='utf-8') as lg:
        for i, f in enumerate(files):
            try:
                r = parse_file(f); results.append(r)
                if r.get('error'): bad.append(f + '\t' + r['error'])
            except Exception as e:
                bad.append(f + '\t' + str(e).replace('\n', ' ')[:120])
            if (i + 1) % 50 == 0:
                lg.write('%s %d/%d ok=%d bad=%d\n' % (datetime.datetime.now().strftime('%H:%M:%S'), i + 1, len(files), len(results) - sum(1 for x in results if x.get('error')), len(bad))); lg.flush()
                json.dump(results, open(outp, 'w', encoding='utf-8'), ensure_ascii=False)
    json.dump(results, open(outp, 'w', encoding='utf-8'), ensure_ascii=False)
    open(badp, 'w', encoding='utf-8').write('\n'.join(bad))
    ok = [r for r in results if not r.get('error')]
    print('読めた', len(ok), '件 / 読めなかった', len(bad), '件 →', outp)

if __name__ == '__main__':
    main()
