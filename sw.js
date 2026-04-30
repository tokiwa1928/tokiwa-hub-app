// TOKIWA-HUB Service Worker
// Notification 対応 + 簡易キャッシュ

const CACHE_NAME = 'tokiwa-hub-v1';

self.addEventListener('install', function(event){
  self.skipWaiting();
});

self.addEventListener('activate', function(event){
  event.waitUntil(self.clients.claim());
});

// Notification をクリックしたら該当ページに飛ぶ
self.addEventListener('notificationclick', function(event){
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || '/tokiwa-hub-app/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList){
      for(var i = 0; i < clientList.length; i++){
        var c = clientList[i];
        if(c.url.indexOf(url) >= 0 && 'focus' in c){
          return c.focus();
        }
      }
      if(clients.openWindow) return clients.openWindow(url);
    })
  );
});

// Web Push (将来用に予約)。今は使わないが空ハンドラで備える
self.addEventListener('push', function(event){
  if(!event.data) return;
  try {
    var data = event.data.json();
    event.waitUntil(
      self.registration.showNotification(data.title || 'TOKIWA-HUB', {
        body: data.body || '',
        icon: data.icon || '/tokiwa-hub-app/icon.png',
        data: data
      })
    );
  } catch(e) {}
});

// メインスレッドからメッセージ → showNotification (代理)
self.addEventListener('message', function(event){
  if(event.data && event.data.type === 'SHOW_NOTIFICATION'){
    self.registration.showNotification(event.data.title, event.data.options || {});
  }
});
