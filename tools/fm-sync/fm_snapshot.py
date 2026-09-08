# -*- coding: utf-8 -*-
"""
FileMaker の設計スナップショット（変更前後の記録と差分）

  基幹システムを触る前後で「何がどう変わったか」を1件単位で残す。
  レイアウト一覧・各レイアウトの項目（名前と種別）・件数を記録し、
  2つのスナップショットを突き合わせて増減を出す。

  これは「設計の記録」であって、壊れたレイアウトを自動で戻すものではない。
  復元そのものは FileMaker Cloud のバックアップに頼る。
  ただし「何を戻せばよいか」がこれで確定する。

  使い方:
    python fm_snapshot.py                 … いまの状態を記録
    python fm_snapshot.py --note "○○追加前"
    python fm_snapshot.py --list          … 記録の一覧
    python fm_snapshot.py --diff          … 直近2つを比較
    python fm_snapshot.py --diff A B      … 指定した2つを比較
    python fm_snapshot.py --with-data     … 受注データ本体も丸ごと保存（時間がかかる）

  保存先: C:\\gdrive-migration\\fm-backup\\<日時>\\
"""
import sys, os, io, json, time, argparse, datetime
from urllib.parse import quote

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fm_client as F

ROOT = r'C:\gdrive-migration\fm-backup'
DATA_LAYOUT = 'Hub連携'


def snapshot(note='', with_data=False):
    stamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
    out = os.path.join(ROOT, stamp)
    os.makedirs(out, exist_ok=True)
    t0 = time.time()

    fmid = F.id_token()
    with F.FM(F.DB_DATA, fmid) as fm:
        lays = fm.layouts()
        print('  レイアウト %d 件の設計を記録します' % len(lays), flush=True)
        design = {}
        for i, lay in enumerate(lays, 1):
            try:
                r = F.http_json('%s/layouts/%s' % (fm.base, quote(lay)),
                                headers={'Authorization': 'Bearer ' + fm.token}, timeout=40)
                if r.get('messages', [{}])[0].get('code') != '0':
                    design[lay] = {'error': r.get('messages', [{}])[0]}
                    continue
                meta = r['response']
                design[lay] = {
                    'fields': [{'name': f['name'], 'type': f.get('type'),
                                'result': f.get('result')}
                               for f in meta.get('fieldMetaData', [])],
                    'portals': sorted(meta.get('portalMetaData', {}).keys()),
                }
            except Exception as e:
                design[lay] = {'error': '%s: %s' % (type(e).__name__, e)}
            if i % 10 == 0:
                print('    %d/%d' % (i, len(lays)), flush=True)

        # 件数（軽いレイアウトのみ。重いものは飛ばす）
        counts = {}
        for lay in lays:
            d = design.get(lay, {})
            if 'fields' not in d or len(d['fields']) > 200:
                continue
            try:
                r = F.http_json('%s/layouts/%s/records?_limit=1' % (fm.base, quote(lay)),
                                headers={'Authorization': 'Bearer ' + fm.token}, timeout=10)
                if r.get('messages', [{}])[0].get('code') == '0':
                    counts[lay] = r['response'].get('dataInfo', {}).get('totalRecordCount')
            except Exception:
                pass

        payload = {
            'stamp': stamp,
            'note': note,
            'host': F.FM_HOST,
            'database': F.DB_DATA,
            'layout_count': len(lays),
            'design': design,
            'counts': counts,
        }
        with open(os.path.join(out, 'design.json'), 'w', encoding='utf-8') as f:
            json.dump(payload, f, ensure_ascii=False, indent=1)

        if with_data:
            print('  受注データ本体を保存します（数分かかります）', flush=True)
            rows, off = [], 1
            while True:
                page = fm.records(DATA_LAYOUT, offset=off, limit=200)
                if not page:
                    break
                rows += [x['fieldData'] for x in page]
                if len(rows) % 5000 < 200:
                    print('    %d件' % len(rows), flush=True)
                if len(page) < 200:
                    break
                off += 200
            with open(os.path.join(out, 'data_%s.json' % DATA_LAYOUT), 'w', encoding='utf-8') as f:
                json.dump({'layout': DATA_LAYOUT, 'count': len(rows), 'records': rows},
                          f, ensure_ascii=False)
            print('  %d件を保存しました' % len(rows))

    print()
    print('  記録しました: %s  (%.1f秒)' % (out, time.time() - t0))
    if note:
        print('  メモ: %s' % note)
    return out


def load(name):
    p = os.path.join(ROOT, name, 'design.json')
    return json.load(open(p, encoding='utf-8'))


def snaps():
    if not os.path.isdir(ROOT):
        return []
    return sorted(d for d in os.listdir(ROOT)
                  if os.path.exists(os.path.join(ROOT, d, 'design.json')))


def diff(a, b):
    A, B = load(a), load(b)
    print()
    print('  %s  →  %s' % (a, b))
    if A.get('note') or B.get('note'):
        print('  メモ: %s → %s' % (A.get('note', '-'), B.get('note', '-')))
    print()

    la, lb = set(A['design']), set(B['design'])
    add, rem = sorted(lb - la), sorted(la - lb)
    if add: print('  ■ 増えたレイアウト'); [print('     + %s' % x) for x in add]
    if rem: print('  ■ 消えたレイアウト'); [print('     - %s' % x) for x in rem]

    changed = 0
    for lay in sorted(la & lb):
        fa = A['design'][lay].get('fields')
        fb = B['design'][lay].get('fields')
        if fa is None or fb is None:
            continue
        na = {f['name']: f for f in fa}
        nb = {f['name']: f for f in fb}
        plus, minus = sorted(set(nb) - set(na)), sorted(set(na) - set(nb))
        moved = [k for k in set(na) & set(nb)
                 if na[k].get('type') != nb[k].get('type')
                 or na[k].get('result') != nb[k].get('result')]
        if plus or minus or moved:
            changed += 1
            print('  ■ %s' % lay)
            for x in plus:  print('     + %s (%s)' % (x, nb[x].get('type')))
            for x in minus: print('     - %s (%s)' % (x, na[x].get('type')))
            for x in moved:
                print('     ~ %s  %s→%s' % (x, na[x].get('type'), nb[x].get('type')))

    print()
    for lay in sorted(set(A.get('counts', {})) & set(B.get('counts', {}))):
        ca, cb = A['counts'][lay], B['counts'][lay]
        if ca != cb:
            print('  ● 件数変化 %-24s %s → %s (%+d)' % (lay, f'{ca:,}', f'{cb:,}', cb - ca))

    if not add and not rem and not changed:
        print('  設計の変更はありません')
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--note', default='', help='この記録の目的（例: ○○追加前）')
    ap.add_argument('--with-data', action='store_true', help='受注データ本体も保存する')
    ap.add_argument('--list', action='store_true', help='記録の一覧')
    ap.add_argument('--diff', nargs='*', help='2つを比較（省略時は直近2つ）')
    a = ap.parse_args()

    if a.list:
        s = snaps()
        print()
        print('  記録 %d 件' % len(s))
        for x in s:
            d = load(x)
            print('    %s  レイアウト%d  %s' % (x, d['layout_count'], d.get('note', '')))
        return 0

    if a.diff is not None:
        s = snaps()
        if len(a.diff) == 2:
            return diff(a.diff[0], a.diff[1])
        if len(s) < 2:
            print('  比較できる記録が2つありません'); return 1
        return diff(s[-2], s[-1])

    print()
    print('  FileMaker 設計スナップショット')
    snapshot(note=a.note, with_data=a.with_data)
    return 0


if __name__ == '__main__':
    sys.exit(main())
