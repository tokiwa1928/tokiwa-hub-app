# -*- coding: utf-8 -*-
"""FileMaker 中継（GAS）の動作確認。

   設置直後に、読み・検索・書き込み・二重更新の弾き方までを一通り確かめる。
   書き込みは対象レコードの全項目を先に控え、最後に元へ戻す。

   使い方:
     python 中継テスト.py <ウェブアプリのURL> <DEV_KEY> [伝票番号]
"""
import sys, io, json, time, os
import urllib.request, urllib.error

if hasattr(sys.stdout, 'buffer'):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8',
                                  errors='replace', line_buffering=True)

TEST_FIELD = '注文書No'      # 使用率0.5%の自由記入欄。検証用に借りるだけ
TEST_VALUE = 'HUBTEST'
BACKUP_DIR = r'C:\gdrive-migration\fm-backup\write-test'


def call(url, dev_key, action, **kw):
    body = dict(kw); body['action'] = action; body['devKey'] = dev_key
    req = urllib.request.Request(
        url, data=json.dumps(body, ensure_ascii=False).encode('utf-8'),
        headers={'Content-Type': 'application/json'}, method='POST')
    t0 = time.time()
    try:
        raw = urllib.request.urlopen(req, timeout=120).read().decode('utf-8')
    except urllib.error.HTTPError as e:
        raise SystemExit('HTTP %s\n%s' % (e.code, e.read().decode('utf-8', 'replace')[:500]))
    dt = time.time() - t0
    r = json.loads(raw)
    if not r.get('ok'):
        raise SystemExit('中継がエラーを返しました: %s' % r.get('error'))
    return r['data'], dt


def main():
    if len(sys.argv) < 3:
        print(__doc__); return 1
    url, dev_key = sys.argv[1], sys.argv[2]
    denpyo = sys.argv[3] if len(sys.argv) > 3 else 'a104362'

    print()
    print('  FileMaker 中継の動作確認')
    print('  %s' % url)
    print()

    d, dt = call(url, dev_key, 'ping')
    print('  疎通            %5.2f秒  %s / 画面 %s' % (dt, d['db'], '、'.join(d['screens'])))

    d, dt = call(url, dev_key, 'fields')
    print('  項目一覧        %5.2f秒  書ける %d / 読むだけ %d'
          % (dt, len(d['writable']), len(d['readonly'])))
    writable = set(d['writable'])
    if TEST_FIELD not in writable:
        raise SystemExit('  × %s が書ける項目に入っていません' % TEST_FIELD)

    rec, dt = call(url, dev_key, 'get', denpyo=denpyo)
    if not rec:
        raise SystemExit('  × 伝票 %s が見つかりません' % denpyo)
    print('  1件読み込み     %5.2f秒  %s / 項目 %d / modId %s'
          % (dt, denpyo, len(rec['fields']), rec['modId']))

    if not os.path.isdir(BACKUP_DIR):
        os.makedirs(BACKUP_DIR)
    stamp = time.strftime('%Y%m%d-%H%M%S')
    path = os.path.join(BACKUP_DIR, '%s_%s_中継テスト前.json' % (denpyo, stamp))
    json.dump(rec, open(path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('  変更前を控えた         %s' % path)

    before = dict(rec['fields'])
    orig = before.get(TEST_FIELD, '')

    d, dt = call(url, dev_key, 'update', recordId=rec['recordId'], modId=rec['modId'],
                 fields={TEST_FIELD: TEST_VALUE, '合計金額': 999999})
    if d.get('conflict'):
        raise SystemExit('  × 別の人が更新中でした。時間をおいて試してください')
    print('  書き込み        %5.2f秒  書けた %s / 無視した %s'
          % (dt, '、'.join(d['saved']), '、'.join(d['ignored']) or 'なし'))
    if '合計金額' in d['saved']:
        raise SystemExit('  × 計算フィールドが書けてしまいました。許可リストが効いていません')
    if d['fields'].get(TEST_FIELD) != TEST_VALUE:
        raise SystemExit('  × 書いた値が反映されていません')

    stale, dt = call(url, dev_key, 'update', recordId=rec['recordId'], modId=rec['modId'],
                     fields={TEST_FIELD: 'ZZZ'})
    if not stale.get('conflict'):
        raise SystemExit('  × 古い modId で書けてしまいました。二重更新を防げていません')
    print('  古いmodIdで再送 %5.2f秒  弾かれた（正常）' % dt)

    back, dt = call(url, dev_key, 'update', recordId=rec['recordId'], modId=d['modId'],
                    fields={TEST_FIELD: orig})
    print('  書き戻し        %5.2f秒' % dt)

    after = back['fields']
    diff = [k for k in before if before[k] != after.get(k)]
    print()
    if diff:
        print('  × 元と違う項目が %d 件あります: %s' % (len(diff), '、'.join(diff)))
        return 1
    print('  ○ 全 %d 項目が変更前と一致しました。中継は正常です。' % len(before))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
