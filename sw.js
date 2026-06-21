// DropControl — Service Worker
// Mise à jour automatique à chaque déploiement

const CACHE_VERSION = 'dropcontrol-v3';
const ASSETS = [
  '/dropcontrol/',
  '/dropcontrol/index.html',
  '/dropcontrol/app.js',
  '/dropcontrol/manifest.json',
  '/dropcontrol/icon-192.png',
  '/dropcontrol/icon-512.png',
  '/dropcontrol/apple-touch-icon.png'
];

// Installation — met en cache les assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting(); // Activation immédiate
});

// Activation — supprime TOUS les anciens caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => {
        console.log('[SW] Suppression ancien cache:', k);
        return caches.delete(k);
      }))
    )
  );
  self.clients.claim(); // Prend le contrôle immédiatement
});

// Fetch — Network First : toujours le réseau en priorité, cache en fallback
self.addEventListener('fetch', event => {
  // Ignore les requêtes non-GET et les requêtes externes (Supabase, Gemini)
  if (event.request.method !== 'GET') return;
  if (!event.request.url.includes(self.location.origin)) return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Met à jour le cache avec la nouvelle version
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_VERSION).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => {
        // Hors-ligne : sert depuis le cache
        return caches.match(event.request) || caches.match('/dropcontrol/index.html');
      })
  );
});
