/* Service worker : rend le site installable et utilisable hors-ligne (dernières données en cache).
 * Stratégie « réseau d'abord » pour les fichiers du site, afin de toujours récupérer la dernière version. */
const CACHE = 'apistock-93cb327fc6'; // calculé par scripts/sw-version.mjs (ne pas modifier à la main)
const ASSETS = ['./', 'index.html', 'css/style.css', 'js/utils.js', 'js/store.js', 'js/api.js', 'js/markets.js',
  'js/portfolio.js', 'js/charts.js', 'js/app.js', 'js/views.js', 'js/compare.js', 'js/extras.js', 'js/mobile.js', 'js/features.js',
  'js/money.js', 'js/insights.js', 'manifest.webmanifest', 'icons/icon-192.png'];

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
    fetch(e.request, { cache: 'no-cache' }).then(res => { // revalide auprès du serveur (ignore le cache HTTP de 10 min de GitHub Pages)
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))) // « ?v= » ignoré hors ligne
  );
});

// alertes de prix envoyées par le worker Cloudflare (site fermé)
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'APIstock', {
    body: d.body || '', tag: d.tag || undefined, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { url: './#invest' },
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => (list[0] ? list[0].focus() : self.clients.openWindow('./#invest'))));
});
