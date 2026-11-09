# -*- coding: utf-8 -*-
"""
グループベース単価の取込（GROUPBASE-1）

  叩き台の xlsx（グループベース単価表_叩き台_YYMMDD.xlsx）を読んで、
  tools/group-base.html の「📥 JSON取込」で読める JSON を書き出す。

  使い方（PowerShell）
    python tools/group-base-import.py "G:\\共有ドライブ\\有限会社アート・エス\\総務・経理\\見積\\_見積データベース\\グループベース単価表_叩き台_261108.xlsx"
    python tools/group-base-import.py <xlsx> -o tools/group-base.json      ← 書き出し先を変える（既定は tools/group-base.json）

  読むシート
    1_用紙 / 2_封筒 / 3_印刷 / 4_版・製版 / 5_加工・製本 → sheet = 用紙 / 封筒 / 印刷 / 版・製版 / 加工・製本
    7_利益率                                           → sheet = 利益率（item = 区分名、unit = 率）
    3_印刷 は「判」と「通し枚数の帯」の 2 列が項目なので、item = 「判 帯」に結合する（han / band にも残す）

  JSON の 1 行 = xlsx の 1 行（DB.groupBase と同じ形。id は画面の取込で付く）
    sheet, cat, item, unit, n, nRecent, lastDate, lastPrice, median, q75, min, max, draft, adopted, note
    採用値（記入）が空なら adopted = null（有効単価 = adopted ?? draft）

  要るもの: openpyxl（pip install openpyxl）
"""
import sys, json, argparse, datetime, os

try:
    import openpyxl
except ImportError:
    sys.exit('openpyxl がありません。 pip install openpyxl を実行してください')

SHEETS = [
    ('1_用紙',      '用紙'),
    ('2_封筒',      '封筒'),
    ('3_印刷',      '印刷'),
    ('4_版・製版',  '版・製版'),
    ('5_加工・製本', '加工・製本'),
]
RATE_SHEET = ('7_利益率', '利益率')

# 列名のゆれ（「採用値（記入）」「採用値」など）を吸収する
COLS = {
    '区分': 'cat', '項目': 'item', '単位': 'unit',
    '件数(全)': 'n', '件数（全）': 'n', '件数': 'n',
    '件数(期間内)': 'nRecent', '件数（期間内）': 'nRecent',
    '最新日': 'lastDate', '最新単価': 'lastPrice', '中央値': 'median', '上位25%': 'q75',
    '最小': 'min', '最大': 'max', '叩き台': 'draft',
    '採用値（記入）': 'adopted', '採用値(記入)': 'adopted', '採用値': 'adopted',
    '出所・備考': 'note', '備考': 'note',
    '判': 'han', '通し枚数の帯': 'band',
}
RATE_COLS = {
    '区分': 'item', '村山 件数': 'n', '村山 中央値': 'median', '村山 上位25%': 'q75',
    'アート・エス 件数': 'artN', 'アート・エス 中央値': 'artMedian', 'アート・エス 上位25%': 'artQ75',
    '叩き台': 'draft', '採用値（記入）': 'adopted', '採用値(記入)': 'adopted', '採用値': 'adopted', '備考': 'note',
}
NUM = ('n', 'nRecent', 'lastPrice', 'median', 'q75', 'min', 'max', 'draft', 'adopted', 'artN', 'artMedian', 'artQ75')


def s(v):
    """文字列に（None は空、日付は YYYY-MM-DD）"""
    if v is None:
        return ''
    if isinstance(v, (datetime.datetime, datetime.date)):
        return v.strftime('%Y-%m-%d')
    return str(v).strip()


def num(v):
    """数に（空・文字は None）。小数は 4 桁で丸める"""
    if v is None or v == '':
        return None
    try:
        f = float(str(v).replace(',', '').replace('¥', '').replace('円', ''))
    except ValueError:
        return None
    return round(f, 4)


INT = ('n', 'nRecent', 'artN')


def read_sheet(ws, sheet_name, colmap):
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        return []
    head = [s(h) for h in rows[0]]
    idx = {}
    for i, h in enumerate(head):
        if h in colmap:
            idx[colmap[h]] = i
    out = []
    for r in rows[1:]:
        if r is None or all(c is None or s(c) == '' for c in r):
            continue
        o = {'sheet': sheet_name}
        for key, i in idx.items():
            v = r[i] if i < len(r) else None
            o[key] = num(v) if key in NUM else s(v)
            if key in INT and o[key] is not None:
                o[key] = int(o[key])
        # 3_印刷: 判 ＋ 通し枚数の帯 → item
        if 'han' in idx or 'band' in idx:
            o['item'] = ' '.join(x for x in [o.get('han', ''), o.get('band', '')] if x)
        if sheet_name == '利益率':
            o['cat'] = '利益率'
            o['unit'] = '率'
        for k in ('cat', 'item', 'unit', 'note', 'lastDate'):
            o.setdefault(k, '')
        for k in NUM:
            if k in ('artN', 'artMedian', 'artQ75') and sheet_name != '利益率':
                continue
            o.setdefault(k, None)
        if not o['item']:
            continue
        out.append(o)
    return out


def main():
    ap = argparse.ArgumentParser(description='グループベース単価の叩き台 xlsx → JSON')
    ap.add_argument('xlsx', help='グループベース単価表_叩き台_YYMMDD.xlsx')
    ap.add_argument('-o', '--out', default=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'group-base.json'))
    a = ap.parse_args()

    wb = openpyxl.load_workbook(a.xlsx, data_only=True, read_only=True)
    names = wb.sheetnames
    rows, counts = [], {}
    for xl, sheet in SHEETS + [RATE_SHEET]:
        if xl not in names:
            print('  シートが無い: ' + xl + '（飛ばす）')
            continue
        colmap = RATE_COLS if sheet == '利益率' else COLS
        got = read_sheet(wb[xl], sheet, colmap)
        counts[sheet] = len(got)
        rows.extend(got)

    out = {
        '_': 'グループベース単価（叩き台）。tools/group-base.html の「📥 JSON取込」で読む',
        'source': os.path.basename(a.xlsx),
        'exportedAt': datetime.datetime.now().isoformat(timespec='seconds'),
        'counts': counts,
        'rows': rows,
    }
    with open(a.out, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print('書き出した: ' + a.out)
    for k, v in counts.items():
        print('  %s: %d 行' % (k, v))
    print('  合計: %d 行' % len(rows))


if __name__ == '__main__':
    main()
