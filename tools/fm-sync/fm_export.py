# -*- coding: utf-8 -*-
"""
FileMaker「受注データ」を読み出して CSV / JSON に落とす

  レイアウト「Hub連携」（54項目）から受注を読み、
  得意先コード・担当者コードをマスタで名前に変換したうえで書き出す。
  日付は FileMaker の MM/DD/YYYY から YYYY-MM-DD に直す。

  使い方:
    python fm_export.py                 … 全件
    python fm_export.py --days 31       … 起票日が過去31日分だけ
    python fm_export.py --days 21 --out D:\\somewhere
    python fm_export.py --layout 受注データ  … レイアウトを変えて試す

  出力（既定 C:\\gdrive-migration\\fm-export）:
    fm_受注_YYYYMMDD.csv    Excel でそのまま開ける（UTF-8 BOM）
    fm_受注_YYYYMMDD.json   突合ツール用
    fm_受注_latest.json     毎朝の差分比較はこれを見る
"""
import sys, os, io, csv, json, time, argparse, datetime
from urllib.parse import quote

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fm_client as F

LAYOUT   = 'Hub連携'
PAGE     = 200
MST_PAGE = 500          # マスタは1ページを大きく（往復回数を減らす）
MST_HOURS = 24          # マスタのキャッシュ有効時間
OUT_DIR  = r'C:\gdrive-migration\fm-export'
DATE_KEYS = ('起票日', '納期', '納品日', '前回起票日')


BAD_CHARS = '\\/:*?"<>|'      # ファイル名に使えない文字 → -
CTRL_CHARS = '\r\n\t'         # 改行やタブ → 取り除く（データに混入している）


def clean(v):
    """改行・タブを取り除いて前後の空白を落とす

    FileMaker のデータには末尾に改行が入っている項目が実在するため、
    FileMaker 側の計算式とまったく同じ規則でそろえる。
    """
    s = str(v or '')
    for ch in CTRL_CHARS:
        s = s.replace(ch, '')
    s = s.replace('　', ' ')   # 全角スペースは半角に寄せる（FileMaker の Trim に合わせる）
    return s.strip(' ')


def note_title(r):
    """ノート用タイトル  伝票番号_得意先名(ユーザー名)_品名

    ・ユーザー名が空なら括弧ごと省く
    ・品名は製品名、無ければ物品名
    ・空の部分は区切り文字ごと省く
    ・ファイル名に使えない文字は - に置き換える
    """
    denpyo = clean(r.get('伝票番号'))
    cust   = clean(r.get('得意先名'))
    user   = clean(r.get('ユーザー名'))
    item   = clean(r.get('製品名')) or clean(r.get('物品名'))
    if user:
        cust = '%s(%s)' % (cust, user)
    t = '_'.join(x for x in (denpyo, cust, item) if x)
    for ch in BAD_CHARS:
        t = t.replace(ch, '-')
    return t.strip()


def fm_date(d):
    """datetime → FileMaker の検索用 MM/DD/YYYY"""
    return '%02d/%02d/%04d' % (d.month, d.day, d.year)


def iso_date(v):
    """FileMaker の MM/DD/YYYY → YYYY-MM-DD（空はそのまま）"""
    if not v:
        return ''
    s = str(v).strip()
    for fmt in ('%m/%d/%Y', '%Y/%m/%d', '%Y-%m-%d'):
        try:
            return datetime.datetime.strptime(s, fmt).strftime('%Y-%m-%d')
        except ValueError:
            pass
    return s


def fetch_all(fm, layout, query=None, label='', page=PAGE):
    """ページ送りしながら全件取る"""
    out, offset = [], 1
    while True:
        t = time.time()
        if query:
            rows = fm.find(layout, query, offset=offset, limit=page)
        else:
            rows = fm.records(layout, offset=offset, limit=page)
        if not rows:
            break
        out += [r['fieldData'] for r in rows]
        print('    %s %6d件 (%.1f秒)' % (label, len(out), time.time() - t), flush=True)
        if len(rows) < page:
            break
        offset += page
    return out


def masters(fm, out_dir, force=False):
    """得意先・社員マスタ。日々変わるものではないのでキャッシュする"""
    p = os.path.join(out_dir, 'masters.json')
    if not force and os.path.exists(p):
        age = (time.time() - os.path.getmtime(p)) / 3600.0
        if age < MST_HOURS:
            d = json.load(open(p, encoding='utf-8'))
            print('  マスタはキャッシュを使用（%.1f時間前）: 得意先%d件 / 社員%d件'
                  % (age, len(d['cust']), len(d['staff'])))
            return d['cust'], d['staff']

    print('  マスタを読み込み中…', flush=True)
    cust = {r['得意先コード']: r.get('得意先名', '')
            for r in fetch_all(fm, '得意先マスタ', label='得意先', page=MST_PAGE)}
    staff = {r['社員コード']: r.get('氏名', '')
             for r in fetch_all(fm, '社員マスタ', label='社員', page=MST_PAGE)}
    with open(p, 'w', encoding='utf-8') as f:
        json.dump({'cust': cust, 'staff': staff}, f, ensure_ascii=False)
    print('  得意先 %d件 / 社員 %d件' % (len(cust), len(staff)))
    return cust, staff


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--days', type=int, default=0, help='起票日が過去N日分だけ（0=全件）')
    ap.add_argument('--layout', default=LAYOUT)
    ap.add_argument('--out', default=OUT_DIR)
    ap.add_argument('--refresh-masters', action='store_true',
                    help='得意先・社員マスタを取り直す')
    a = ap.parse_args()

    os.makedirs(a.out, exist_ok=True)
    print()
    print('  FileMaker 受注データ 書き出し')
    print('  レイアウト: %s' % a.layout)
    print('  範囲      : %s' % ('過去%d日' % a.days if a.days else '全件'))
    print()

    fmid = F.id_token()
    t0 = time.time()
    with F.FM(F.DB_DATA, fmid) as fm:
        cust, staff = masters(fm, a.out, force=a.refresh_masters)
        print()

        query = None
        if a.days:
            since = datetime.date.today() - datetime.timedelta(days=a.days)
            query = [{'起票日': '>=%s' % fm_date(since)}]
            print('  起票日 %s 以降を検索' % since.isoformat())

        print('  受注データを読み込み中…', flush=True)
        try:
            rows = fetch_all(fm, a.layout, query, label='受注')
        except RuntimeError as e:
            if '105' in str(e) or 'Layout' in str(e):
                print()
                print('  × レイアウト「%s」が見つかりません。' % a.layout)
                print('    FileMaker Pro でトキワ印刷DBを開き、')
                print('    tools/fm-sync/layout-fields.txt の54項目で作成してください。')
                return 1
            raise

    # 整形
    for r in rows:
        for k in DATE_KEYS:
            if k in r:
                r[k] = iso_date(r[k])
        # コードの末尾に改行が入っているレコードが実在するので必ず clean する
        r['得意先名'] = cust.get(clean(r.get('得意先コード')), '')
        r['担当者名'] = staff.get(clean(r.get('担当者コード')), '')
        r['ノート用タイトル'] = note_title(r)

    stamp = datetime.date.today().strftime('%Y%m%d')
    cols = list(rows[0].keys()) if rows else []
    csv_p  = os.path.join(a.out, 'fm_受注_%s.csv' % stamp)
    json_p = os.path.join(a.out, 'fm_受注_%s.json' % stamp)
    last_p = os.path.join(a.out, 'fm_受注_latest.json')

    with open(csv_p, 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction='ignore')
        w.writeheader()
        w.writerows(rows)
    payload = {'取得日時': datetime.datetime.now().isoformat(timespec='seconds'),
               'レイアウト': a.layout, '範囲': ('過去%d日' % a.days if a.days else '全件'),
               '件数': len(rows), 'records': rows}
    for p in (json_p, last_p):
        with open(p, 'w', encoding='utf-8') as f:
            json.dump(payload, f, ensure_ascii=False, indent=1)

    print()
    print('  %d件 / %d項目 を書き出しました (%.1f秒)' % (len(rows), len(cols), time.time() - t0))
    print('    %s' % csv_p)
    print('    %s' % json_p)
    print('    %s' % last_p)
    return 0


if __name__ == '__main__':
    sys.exit(main())
