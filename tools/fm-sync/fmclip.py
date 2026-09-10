# -*- coding: utf-8 -*-
"""FileMaker のスクリプトステップを クリップボード (Mac-XMSS) で読み書きする。
   読み: python fmclip.py get out.xml
   書き: python fmclip.py put in.xml
   形式: 先頭4バイトに UTF-8 本文の長さ (LE) を置き、そのあとに XML。
"""
import ctypes, struct, sys
from ctypes import wintypes

u32 = ctypes.WinDLL('user32', use_last_error=True)
k32 = ctypes.WinDLL('kernel32', use_last_error=True)

u32.RegisterClipboardFormatW.restype = wintypes.UINT
u32.GetClipboardData.restype = wintypes.HANDLE
u32.SetClipboardData.restype = wintypes.HANDLE
k32.GlobalAlloc.restype = wintypes.HGLOBAL
k32.GlobalLock.restype = wintypes.LPVOID
k32.GlobalSize.restype = ctypes.c_size_t

u32.GetClipboardData.argtypes = [wintypes.UINT]
u32.SetClipboardData.argtypes = [wintypes.UINT, wintypes.HANDLE]
u32.OpenClipboard.argtypes = [wintypes.HWND]
k32.GlobalAlloc.argtypes = [wintypes.UINT, ctypes.c_size_t]
k32.GlobalLock.argtypes = [wintypes.HGLOBAL]
k32.GlobalUnlock.argtypes = [wintypes.HGLOBAL]
k32.GlobalSize.argtypes = [wintypes.HGLOBAL]

FMT = 'Mac-XMSS'   # 既定。レイアウトは Mac-XML2
GMEM_MOVEABLE = 0x0002


def _fmt(name=None):
    return u32.RegisterClipboardFormatW(name or FMT)


def get(fmt=None):
    if not u32.OpenClipboard(None):
        raise OSError('クリップボードを開けません')
    try:
        h = u32.GetClipboardData(_fmt(fmt))
        if not h:
            return None
        p = k32.GlobalLock(h)
        n = k32.GlobalSize(h)
        buf = ctypes.string_at(p, n)
        k32.GlobalUnlock(h)
    finally:
        u32.CloseClipboard()
    ln = struct.unpack('<I', buf[:4])[0]
    return buf[4:4 + ln].decode('utf-8')


def put(xml, fmt=None):
    body = xml.encode('utf-8')
    data = struct.pack('<I', len(body)) + body
    h = k32.GlobalAlloc(GMEM_MOVEABLE, len(data))
    p = k32.GlobalLock(h)
    ctypes.memmove(p, data, len(data))
    k32.GlobalUnlock(h)
    if not u32.OpenClipboard(None):
        raise OSError('クリップボードを開けません')
    try:
        u32.EmptyClipboard()
        if not u32.SetClipboardData(_fmt(fmt), h):
            raise OSError('SetClipboardData に失敗')
    finally:
        u32.CloseClipboard()


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    fmt = sys.argv[3] if len(sys.argv) > 3 else None
    if sys.argv[1] == 'get':
        x = get(fmt)
        if x is None:
            print('Mac-XMSS がありません')
            sys.exit(1)
        open(sys.argv[2], 'w', encoding='utf-8').write(x)
        print('%d 文字を保存しました' % len(x))
    else:
        put(open(sys.argv[2], encoding='utf-8').read(), fmt)
        print('クリップボードに置きました')
