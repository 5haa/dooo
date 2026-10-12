const CACHE = 'dooo-phone-v1';
const SHELL = ['/', '/app.css', '/app.js', '/icon.svg', '/icon-192.png', '/icon-512.png', '/font.woff2', '/manifest.webmanifest'];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('dooo-phone-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith(fetch(event.request).then(response => { if (response.ok && SHELL.includes(url.pathname)) { const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(event.request, copy)); } return response; }).catch(() => caches.match(event.request).then(response => response || caches.match('/'))));
});
self.addEventListener('push', event => {
  let data; try { data = event.data.json(); } catch { data = {}; }
  event.waitUntil(self.registration.showNotification('Dooo', { body: data.body || 'Your PC needs your attention.', icon: '/icon-192.png', badge: '/icon-192.png', tag: data.tag || 'dooo', data: { url: typeof data.url === 'string' && data.url.startsWith('/#run=') ? data.url : '/' } }));
});
self.addEventListener('notificationclick', event => { event.notification.close(); const url = new URL(event.notification.data?.url || '/', self.location.origin).href; event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async clients => { const client = clients[0]; if (client) { await client.navigate(url); return client.focus(); } return self.clients.openWindow(url); })); });
