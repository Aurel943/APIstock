/* Service worker : rend le site installable et utilisable hors-ligne (dernières données en cache).
 * Stratégie « réseau d'abord » pour les fichiers du site, afin de toujours récupérer la dernière version. */
const CACHE = 'apistock-v4';
const ASSETS = ['./', 'index.html', 'css/style.css', 'js/utils.js', 'js/store.js', 'js/api.js', 'js/markets.js',
  'js/portfolio.js', 'js/charts.js', 'js/app.js', 'js/views.js', 'js/compare.js', 'js/extras.js', 'js/mobile.js', 'manifest.webmanifest', 'icons/icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // on ne touche jamais aux appels d'API (cours en direct)
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/')) return;
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('index.html')))
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(list => (list[0] ? list[0].focus() : self.clients.openWindow('./#invest'))));
});
