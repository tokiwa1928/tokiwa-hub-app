# -*- coding: utf-8 -*-
"""保存済みの Claris ID 更新トークンをクリップボードにコピーする。

   画面には出さない。GAS のスクリプトプロパティに貼り付けるためだけのもの。
"""
import sys, os, json, subprocess
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fm_client as C

if not os.path.exists(C.STORE_FIL):
    print()
    print('  更新トークンがまだ保存されていません。')
    print('  先に fm-connect.cmd を実行してサインインしてください。')
    raise SystemExit(1)

saved = json.loads(C.dpapi_unprotect(open(C.STORE_FIL, 'rb').read()).decode('utf-8'))
tok = saved['refresh_token']

p = subprocess.Popen(['clip'], stdin=subprocess.PIPE)
p.communicate(tok.encode('utf-16-le'))

print()
print('  クリップボードにコピーしました。')
print('  アカウント : %s' % saved['username'])
print('  長さ       : %d 文字（先頭 %s… 末尾 …%s）' % (len(tok), tok[:6], tok[-6:]))
print()
print('  Apps Script の スクリプトプロパティ FM_REFRESH_TOKEN に貼り付けてください。')
print('  ※ この値はメールやチャットに貼らないでください。')
