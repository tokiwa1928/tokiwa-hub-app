# -*- coding: utf-8 -*-
"""
FileMaker Cloud (Claris ID) 接続クライアント

  トキワ印刷の FileMaker は Claris の FileMaker Cloud で動いており、
  Data API は Basic 認証を受け付けず、Claris ID から発行される
  FMID トークンだけを受理する。ここではその取得と、
  Data API の呼び出しをまとめて面倒を見る。

  安全のための方針:
    ・Claris ID のパスワードは保存しない。初回の1回だけ入力してもらう。
    ・保存するのは「更新トークン」(有効期間1年)のみ。
    ・保存時は Windows の DPAPI で暗号化するので、
      このPCのこのユーザー以外は復号できない。

  使い方:
    python fm_client.py            … 接続テスト（初回はClaris IDを聞く）
    python fm_client.py --reset    … 保存済みトークンを捨てて入れ直す
"""
import sys, os, io, json, base64, ctypes, getpass, argparse, subprocess
from ctypes import wintypes
from urllib.parse import quote
from urllib.request import Request, urlopen
from urllib.error import HTTPError

if hasattr(sys.stdout, 'buffer'):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

FM_HOST   = 'tokiwa.account.filemaker-cloud.com'
POOL_URL  = 'https://www.ifmcloud.com/endpoint/userpool/2.2.0.my.claris.com.json'
STORE_DIR = os.path.join(os.environ.get('USERPROFILE', os.path.expanduser('~')), '.tokiwa')
STORE_FIL = os.path.join(STORE_DIR, 'claris-id.bin')

# 2ファイル構成（画面用 / データ用）
DB_APP  = 'トキワ印刷AP'
DB_DATA = 'トキワ印刷DB'


# ---------------------------------------------------------------- DPAPI
class _Blob(ctypes.Structure):
    _fields_ = [('cbData', wintypes.DWORD),
                ('pbData', ctypes.POINTER(ctypes.c_char))]


def _to_blob(b):
    buf = ctypes.create_string_buffer(b, len(b))
    return _Blob(len(b), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char))), buf


def _from_blob(blob):
    n = blob.cbData
    out = ctypes.create_string_buffer(n)
    ctypes.memmove(out, blob.pbData, n)
    ctypes.windll.kernel32.LocalFree(blob.pbData)
    return out.raw


def dpapi_protect(data):
    bin_, _keep = _to_blob(data)
    out = _Blob()
    ok = ctypes.windll.crypt32.CryptProtectData(
        ctypes.byref(bin_), 'tokiwa-hub', None, None, None, 0, ctypes.byref(out))
    if not ok:
        raise OSError('暗号化に失敗しました (CryptProtectData)')
    return _from_blob(out)


def dpapi_unprotect(data):
    bin_, _keep = _to_blob(data)
    out = _Blob()
    ok = ctypes.windll.crypt32.CryptUnprotectData(
        ctypes.byref(bin_), None, None, None, None, 0, ctypes.byref(out))
    if not ok:
        raise OSError('復号に失敗しました。保存し直してください (--reset)')
    return _from_blob(out)


# ---------------------------------------------------------------- HTTP
def http_json(url, method='GET', headers=None, body=None, timeout=120):
    data = None
    h = dict(headers or {})
    if body is not None:
        data = json.dumps(body, ensure_ascii=False).encode('utf-8')
        h['Content-Type'] = 'application/json'
    req = Request(url, data=data, headers=h, method=method)
    try:
        with urlopen(req, timeout=timeout) as r:
            raw = r.read()
    except HTTPError as e:
        raw = e.read()
    if not raw:
        return {}
    return json.loads(raw.decode('utf-8'))


# ---------------------------------------------------------------- Claris ID
def pool_config():
    return http_json(POOL_URL)['data']


def _cognito(username=None):
    from pycognito import Cognito
    c = pool_config()
    return Cognito(c['UserPool_ID'], c['Client_ID'],
                   user_pool_region=c['Region'], username=username)


def ask_gui():
    """Windows の資格情報ダイアログで入力してもらう（既定）"""
    ps1 = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ask-credential.ps1')
    r = subprocess.run(
        ['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-STA', '-File', ps1],
        capture_output=True, timeout=600)
    if r.returncode == 2:
        raise RuntimeError('入力がキャンセルされました')
    if r.returncode != 0 or not r.stdout.strip():
        raise RuntimeError('ダイアログを表示できませんでした')
    d = json.loads(r.stdout.decode('utf-8'))
    return d['u'].strip(), d['p']


def ask_console():
    """コンソールで入力してもらう。伏せ字を出して打てているのが分かるようにする"""
    user = input('  メールアドレス: ').strip()
    try:
        import msvcrt
    except ImportError:
        return user, getpass.getpass('  パスワード    : ')
    sys.stdout.write('  パスワード    : ')
    sys.stdout.flush()
    buf = []
    while True:
        ch = msvcrt.getwch()
        if ch in ('\r', '\n'):
            sys.stdout.write('\n'); sys.stdout.flush(); break
        if ch == '\x03':
            raise KeyboardInterrupt
        if ch in ('\x00', '\xe0'):       # 矢印などの特殊キーは2文字で届く
            msvcrt.getwch(); continue
        if ch == '\b':
            if buf:
                buf.pop(); sys.stdout.write('\b \b'); sys.stdout.flush()
            continue
        buf.append(ch)
        sys.stdout.write('*'); sys.stdout.flush()
    return user, ''.join(buf)


def login_interactive(console=False):
    """Claris ID で1回だけサインインし、更新トークンを暗号化保存する"""
    print()
    print('  Claris ID でサインインします。')
    print('  （FileMaker Pro を開くときに使うメールアドレスとパスワード）')
    print('  パスワードは保存されません。保存するのは更新用トークンだけです。')
    print()
    if console:
        user, pwd = ask_console()
    else:
        try:
            print('  入力ダイアログを開きます…')
            user, pwd = ask_gui()
        except Exception as e:
            print('  （ダイアログが使えないため、この画面で入力します: %s）' % e)
            user, pwd = ask_console()

    u = _cognito(user)
    u.authenticate(password=pwd)
    del pwd

    os.makedirs(STORE_DIR, exist_ok=True)
    blob = dpapi_protect(json.dumps(
        {'username': user, 'refresh_token': u.refresh_token}).encode('utf-8'))
    with open(STORE_FIL, 'wb') as f:
        f.write(blob)
    try:
        os.chmod(STORE_FIL, 0o600)
    except OSError:
        pass
    print()
    print('  サインインできました。')
    print('  更新トークンを暗号化して保存しました: %s' % STORE_FIL)
    return u.id_token


def id_token(reset=False, console=False):
    """保存済みの更新トークンから、1時間有効な FMID トークンを得る"""
    if reset and os.path.exists(STORE_FIL):
        os.remove(STORE_FIL)
    if not os.path.exists(STORE_FIL):
        return login_interactive(console)

    saved = json.loads(dpapi_unprotect(open(STORE_FIL, 'rb').read()).decode('utf-8'))
    u = _cognito(saved['username'])
    u.refresh_token = saved['refresh_token']
    try:
        u.renew_access_token()
    except Exception as e:
        print('  保存済みトークンが使えませんでした（%s）。入れ直します。' % type(e).__name__)
        return login_interactive(console)
    return u.id_token


# ---------------------------------------------------------------- Data API
class FM:
    def __init__(self, database, fmid):
        self.db = database
        self.base = 'https://%s/fmi/data/vLatest/databases/%s' % (FM_HOST, quote(database))
        self.fmid = fmid
        self.token = None

    def __enter__(self):
        r = http_json(self.base + '/sessions', 'POST',
                      {'Authorization': 'FMID ' + self.fmid}, {})
        m = r.get('messages', [{}])[0]
        if m.get('code') != '0':
            raise RuntimeError('%s への接続に失敗 (code %s): %s'
                               % (self.db, m.get('code'), m.get('message')))
        self.token = r['response']['token']
        return self

    def __exit__(self, *a):
        if self.token:
            try:
                http_json('%s/sessions/%s' % (self.base, self.token), 'DELETE',
                          {'Authorization': 'Bearer ' + self.token})
            except Exception:
                pass

    def _auth(self):
        return {'Authorization': 'Bearer ' + self.token}

    def layouts(self):
        r = http_json(self.base + '/layouts', headers=self._auth())
        out = []
        for l in r.get('response', {}).get('layouts', []):
            if l.get('isFolder'):
                out += [c['name'] for c in l.get('folderLayoutNames', [])]
            else:
                out.append(l['name'])
        return out

    def records(self, layout, offset=1, limit=100):
        u = '%s/layouts/%s/records?_offset=%d&_limit=%d' % (
            self.base, quote(layout), offset, limit)
        r = http_json(u, headers=self._auth())
        m = r.get('messages', [{}])[0]
        if m.get('code') != '0':
            raise RuntimeError('取得に失敗 (code %s): %s' % (m.get('code'), m.get('message')))
        return r['response']['data']

    def find(self, layout, query, offset=1, limit=100, sort=None):
        body = {'query': query, 'offset': str(offset), 'limit': str(limit)}
        if sort:
            body['sort'] = sort
        r = http_json('%s/layouts/%s/_find' % (self.base, quote(layout)),
                      'POST', self._auth(), body)
        m = r.get('messages', [{}])[0]
        if m.get('code') == '401':      # 該当0件はエラー扱いで返る
            return []
        if m.get('code') != '0':
            raise RuntimeError('検索に失敗 (code %s): %s' % (m.get('code'), m.get('message')))
        return r['response']['data']


# ---------------------------------------------------------------- 接続テスト
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--reset', action='store_true', help='保存済みトークンを捨てて入れ直す')
    ap.add_argument('--db', default=None, help='対象ファイル（既定は AP→DB の順に試す）')
    ap.add_argument('--console', action='store_true', help='ダイアログでなくこの画面で入力する')
    a = ap.parse_args()

    print()
    print('  FileMaker Cloud 接続テスト')
    print('  ホスト: %s' % FM_HOST)

    try:
        fmid = id_token(reset=a.reset, console=a.console)
    except Exception as e:
        print()
        print('  × Claris ID のサインインに失敗しました: %s' % e)
        print('    2段階認証を有効にしている場合は、この方式は使えません。')
        return 1

    targets = [a.db] if a.db else [DB_APP, DB_DATA]
    for db in targets:
        print()
        print('  → %s を試します' % db)
        try:
            with FM(db, fmid) as fm:
                print('  ✓ 接続できました')
                lays = fm.layouts()
                print('  レイアウト %d 件' % len(lays))
                hit = [x for x in lays if '受注' in x]
                for x in (hit or lays)[:20]:
                    print('    - %s' % x)
                if not hit and len(lays) > 20:
                    print('    …ほか %d 件' % (len(lays) - 20))

                target = (hit or lays or [None])[0]
                if target:
                    print()
                    print('  「%s」から1件読んで項目名を確認します' % target)
                    rec = fm.records(target, limit=1)
                    if rec:
                        fields = sorted(rec[0]['fieldData'].keys())
                        print('  項目 %d 件' % len(fields))
                        out = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                           'fields_%s.txt' % db)
                        with open(out, 'w', encoding='utf-8') as f:
                            f.write('\n'.join(fields))
                        print('  項目名を書き出しました: %s' % out)
                        for x in fields[:25]:
                            print('    - %s' % x)
                        if len(fields) > 25:
                            print('    …ほか %d 件' % (len(fields) - 25))
                    else:
                        print('  レコードが取得できませんでした')
                print()
                print('  成功しました（対象: %s）。毎朝の自動照合を組めます。' % db)
                return 0
        except Exception as e:
            print('    × %s' % e)

    print()
    print('  どのファイルにも接続できませんでした。')
    print('  Claris ID に fmrest（FileMaker Data API でのアクセス）の権限が')
    print('  付いているかご確認ください。')
    return 1


if __name__ == '__main__':
    sys.exit(main())
