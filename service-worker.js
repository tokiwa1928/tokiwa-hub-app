// ============================================================
// TOKIWA-HUB Service Worker (WWWW-2)
// - 静的アセットを Cache First で配信 (爆速起動)
// - GAS API 等のネットワーク呼び出しは Network First (失敗時のみキャッシュ)
// - キャッシュ名の version を上げると自動で旧キャッシュを掃除
// ============================================================

const CACHE_VERSION = 'tokiwa-hub-v603';
const RUNTIME_CACHE = 'tokiwa-hub-runtime-v393';

// 起動時に最低限プリキャッシュするアセット (任意で増やせる)
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// ─── install: 静的アセットを事前キャッシュ ───
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => {
      // 失敗しても無視 (個別ファイルが無い環境でも install を成功させる)
      return Promise.all(
        PRECACHE_URLS.map((url) =>
          cache.add(url).catch((err) => {
            console.warn('[SW] precache miss:', url, err);
          })
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// ─── activate: 古いキャッシュを削除 ───
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_VERSION && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ─── fetch: リクエスト処理 ───
// SW-IFRAME-1: Hub の中に組み込んだ画面（iframe）か、tools/ の画面か
function isEmbedded(req, url) { return req.destination === 'iframe' || req.destination === 'embed' || url.pathname.includes('/tools/'); }
function offlinePage() {
  return new Response('<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<body style="margin:0;font-family:system-ui,sans-serif;background:#f8fafc;color:#334155"><div style="max-width:520px;margin:48px auto;padding:20px 24px;background:#fff;border:1px solid #cbd5e1;border-radius:6px;line-height:1.8">'
    + '<b style="font-size:15px">この画面を読み込めませんでした</b><div style="font-size:13px;margin-top:6px">通信が切れているか、サーバーに届きませんでした。ネットワークを確かめて、<a href="javascript:location.reload()">もう一度読み込む</a>か、いったん別の画面へ移ってから戻ってください。</div></div></body></html>',
    { status: 503, headers: { 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'no-store' } });
}
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // GET 以外はキャッシュしない
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // GAS API (Google Apps Script) や Anthropic API はネットワーク優先
  // 失敗時のみキャッシュフォールバック (= オフラインでも最後のデータが見える)
  const isApi =
    url.host.includes('script.google.com') ||
    url.host.includes('googleusercontent.com') ||
    url.host.includes('api.anthropic.com') ||
    url.host.includes('googleapis.com');

  if (isApi) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // 成功レスポンスのみキャッシュ
          if (res && res.status === 200 && res.type !== 'opaque') {
            const clone = res.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(req, clone));
          }
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // アプリ本体 (index.html / tools/*.html / ナビゲーション) は Network First で常に最新を配信
  //   → デプロイした変更がリロードで即反映される (Cache First だと旧版が出続ける)
  const isAppShell =
    req.mode === 'navigate' ||
    url.pathname.endsWith('.html') ||
    url.pathname.includes('/tools/') ||
    url.pathname.endsWith('/tokiwa-hub-app/') ||
    url.pathname === '/' || url.pathname.endsWith('/');
  if (isAppShell) {
    // SPEED-2: 控えがあれば先に出し、裏でサーバの最新を取り直す（開くのが速い）。
    //   取り直した中身が違っていたら控えを入れ替え、画面に知らせる（Hub は更新バナーを出す）。
    //   cache:'reload' でブラウザの HTTP キャッシュは通さない（GitHub Pages の max-age で旧版が出続けないように）
    const refresh = () => fetch(req, { cache: 'reload' }).then(async (res) => {
      if (res && res.status === 200) {
        const cache = await caches.open(CACHE_VERSION);
        const old = await cache.match(req, { ignoreSearch: true });
        const clone = res.clone();
        let changed = true;
        if (old) { try { const [a, b] = await Promise.all([old.clone().text(), res.clone().text()]); changed = a !== b; } catch (e) { changed = true; } }
        try { await cache.delete(req, { ignoreSearch: true }); } catch (e) {}   // 検索文字列違いの古い控えを残さない（ignoreSearch で古い方が先に当たる）
        await cache.put(req, clone);
        if (changed && old) { try { const cs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true }); cs.forEach((c) => c.postMessage({ type: 'SHELL_UPDATED', url: url.pathname })); } catch (e) {} }
      }
      return res;
    });
    event.respondWith(
      caches.match(req, { ignoreSearch: true }).then((cached) => {
        if (cached) { event.waitUntil(refresh().catch(() => {})); return cached; }
        return refresh();
      })
        // SW-IFRAME-1（本多さん 9/30「サイドバーがだぶる」）: 通信に失敗したとき、組み込みの画面（iframe の tools/…）に index.html を返すと
        //   Hub の中に Hub がもう一つ出てしまう。検索文字列（?mode=…&t=…）を無視して同じ画面の控えを探し、無ければ短い案内を返す
        .catch(() => caches.match(req, { ignoreSearch: true }).then((c) => c || (isEmbedded(req, url) ? offlinePage() : caches.match('./index.html'))))
    );
    return;
  }

  // その他の静的アセット (アイコン等) は Cache First → 失敗時 Network → 同期で更新
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) {
        // バックグラウンドで再取得 (stale-while-revalidate)
        fetch(req)
          .then((res) => {
            if (res && res.status === 200) {
              caches.open(CACHE_VERSION).then((cache) => cache.put(req, res.clone()));
            }
          })
          .catch(() => {});
        return cached;
      }
      return fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const clone = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(req, clone));
          }
          return res;
        })
        .catch(() => {
          // オフライン + 未キャッシュ → index.html を返してナビゲーションを救う
          if (req.mode === 'navigate') return isEmbedded(req, url) ? offlinePage() : caches.match('./index.html');   // SW-IFRAME-1
          return new Response('Offline', { status: 503 });
        });
    })
  );
});

// ─── message: アプリ側からの skipWaiting / バージョンチェック / 通知代理 ───
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0]?.postMessage({ version: CACHE_VERSION });
  }
  // sw.js から統合: メインスレッド → showNotification 代理
  if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
    self.registration.showNotification(event.data.title, event.data.options || {});
  }
});

// ─── 通知 (sw.js から統合) ───
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/tokiwa-hub-app/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (let i = 0; i < clientList.length; i++) {
        const c = clientList[i];
        if (c.url.indexOf(url) >= 0 && 'focus' in c) return c.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
self.addEventListener('push', (event) => {
  if (!event.data) return;
  try {
    const data = event.data.json();
    event.waitUntil(
      self.registration.showNotification(data.title || 'TOKIWA-HUB', {
        body: data.body || '', icon: data.icon || '/tokiwa-hub-app/icons/icon-192.png', data: data
      })
    );
  } catch (e) {}
});
