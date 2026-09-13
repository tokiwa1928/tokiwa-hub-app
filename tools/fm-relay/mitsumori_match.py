# -*- coding: utf-8 -*-
r"""見積実績（mitsumori_scan.py の JSON）と FileMaker の受注（写しの 受注_索引.json）を突き合わせる。
   鍵: 得意先名（得意先マスタでコード→名前）／ユーザー名、品名の似ている度合い、数量、見積日から 1 年以内。
   出力: C:\gdrive-migration\mitsumori_scan\見積突合_YYYYMMDD.json と .csv
     結果: 一致（同じ数量・同じ単価±1%）／金額違い（同じ数量で単価が違う）／数量違い／要確認（品名の似方が弱い）／該当なし
"""
import os, sys, re, json, io, csv, datetime, unicodedata, difflib, argparse
if __name__ == '__main__':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

BASE = r'G:\マイドライブ\TokiwaHub_FileMaker写し'
OUT = r'C:\gdrive-migration\mitsumori_scan'

def nk(s):
    s = unicodedata.normalize('NFKC', str(s or ''))
    s = re.sub(r'(株式会社|有限会社|合同会社|\(株\)|\(有\)|㈱|㈲|様|御中|殿)', '', s)
    s = re.sub(r'[\s\u3000・･\-ー－/／_（）()「」【】\[\]、,.。]', '', s)
    return s.lower()

def fmdate(s):
    m = re.match(r'^(\d\d)/(\d\d)/(\d{4})$', str(s or ''))
    return datetime.date(int(m.group(3)), int(m.group(1)), int(m.group(2))) if m else None

def isodate(s):
    try: return datetime.date.fromisoformat(s[:10])
    except Exception: return None

def fnum(v):
    try: return float(str(v).replace(',', '')) if str(v).strip() not in ('', 'None') else 0.0
    except Exception: return 0.0

def load_fm():
    j = json.load(open(os.path.join(BASE, '受注_索引.json'), encoding='utf-8'))
    col = {c: i for i, c in enumerate(j['列'])}
    m = json.load(open(os.path.join(BASE, 'FM_得意先マスタ.json'), encoding='utf-8'))
    name = {str(r['得意先コード']): r['得意先名'] for r in m['行']}
    orders = []
    for r in j['行']:
        d = fmdate(r[col['起票日']])
        if not d: continue
        code = str(r[col['得意先コード']])
        orders.append({ '伝票番号': str(r[col['伝票番号']]), '日': d, '得意先コード': code, '得意先': name.get(code, ''), 'ユーザー': str(r[col['ユーザー名']] or ''),
                        '製品名': str(r[col['製品名']] or ''), '数量': fnum(r[col['合計数1']]),
                        '売価': fnum(r[col['売価金額']]), '原価': fnum(r[col['合計金額']]),
                        '区分': str(r[col['案件区分']] or '') })
    for o in orders:
        o['_c'] = nk(o['得意先']); o['_u'] = nk(o['ユーザー']); o['_p'] = nk(o['製品名'])
    return orders

def match_item(q, it, orders):
    qd = isodate(q['date']); cust = nk(q['customer']); pn = nk(it['name']); qty = it.get('qty') or 0; price = it.get('price') or 0
    best = None
    for o in orders:
        if qd and not (qd - datetime.timedelta(days=30) <= o['日'] <= qd + datetime.timedelta(days=400)): continue
        cs = 0
        if cust and (cust == o['_c'] or cust == o['_u']): cs = 1.0
        elif cust and len(cust) >= 3 and (cust in o['_c'] or o['_c'] in cust or cust in o['_u'] or (o['_u'] and o['_u'] in cust)): cs = 0.8
        if cs == 0: continue
        ps = difflib.SequenceMatcher(None, pn, o['_p']).ratio() if pn and o['_p'] else 0
        if ps < 0.45 and not (pn and (pn in o['_p'] or o['_p'] in pn)): continue
        qs = 1.0 if (qty and o['数量'] and abs(o['数量'] - qty) / max(qty, 1) <= 0.02) else (0.5 if (qty and o['数量'] and abs(o['数量'] - qty) / max(qty, 1) <= 0.25) else 0.0)
        ds = 1.0 if (qd and abs((o['日'] - qd).days) <= 60) else 0.6
        score = cs * 2 + ps * 2 + qs + ds
        if best is None or score > best[0]: best = (score, o, ps, qs)
    if not best: return { '結果': '該当なし' }
    score, o, ps, qs = best
    unit_fm = (o['売価'] / o['数量']) if o['数量'] else 0
    strong = ps >= 0.6 or (pn and (pn in o['_p'] or o['_p'] in pn))   # 品名がしっかり似ているときだけ言い切る
    if qs == 1.0:
        if price and unit_fm and abs(unit_fm - price) / price <= 0.01: res = '一致'
        elif strong: res = '金額違い'
        else: res = '要確認'
    elif qs >= 0.5 and strong: res = '数量違い'
    elif strong: res = '数量違い'
    else: res = '要確認'
    return { '結果': res, '伝票番号': o['伝票番号'], '受注日': o['日'].isoformat(), '受注数量': o['数量'], '受注売価': o['売価'], '受注単価': round(unit_fm, 2), '受注原価': o['原価'], '受注製品名': o['製品名'], '受注得意先': o['得意先'], '似ている度': round(ps, 2), 'score': round(score, 2) }

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('json', nargs='?', default=None); a = ap.parse_args()
    stamp = datetime.datetime.now().strftime('%Y%m%d')
    src = a.json or os.path.join(OUT, '見積実績_%s.json' % stamp)
    quotes = json.load(open(src, encoding='utf-8'))
    orders = load_fm(); print('受注', len(orders), '見積', len(quotes))
    rows = []; stat = {}
    for q in quotes:
        if q.get('error'): continue
        for it in q['items']:
            if not (it.get('qty') and (it.get('price') or it.get('amount'))): continue
            m = match_item(q, it, orders)
            stat[m['結果']] = stat.get(m['結果'], 0) + 1
            rows.append(dict({ 'file': q['file'], '見積日': q['date'], '得意先': q['customer'], '発行': q['issuer'], '件名': q.get('subject', ''), '品名': it['name'], '数量': it.get('qty'), '単価': it.get('price'), '金額': it.get('amount') }, **m))
    json.dump(rows, open(os.path.join(OUT, '見積突合_%s.json' % stamp), 'w', encoding='utf-8'), ensure_ascii=False)
    keys = ['結果', '見積日', '得意先', '発行', '件名', '品名', '数量', '単価', '金額', '伝票番号', '受注日', '受注数量', '受注単価', '受注売価', '受注原価', '受注製品名', '受注得意先', '似ている度', 'file']
    with open(os.path.join(OUT, '見積突合_%s.csv' % stamp), 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.DictWriter(f, fieldnames=keys, extrasaction='ignore'); w.writeheader(); w.writerows(rows)
    print('明細', len(rows), stat)

if __name__ == '__main__':
    main()
