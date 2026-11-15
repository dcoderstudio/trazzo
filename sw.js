const CACHE_NAME = 'trazzo-v1';

self.addEventListener('install', function(e) {
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys()
      .then(function(keys) { return Promise.all(keys.filter(function(k) { return k !== CACHE_NAME; }).map(function(k) { return caches.delete(k); })); })
      .then(function() { return self.clients.claim(); })
  );
});

// Network-first: always prefer a fresh response while online (this app
// is under active development), falling back to the last cached copy
// only when the network request fails — gives Chrome what it needs to
// treat Trazzo as an installable app, plus basic offline resilience.
self.addEventListener('fetch', function(e) {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then(function(res) {
        var copy = res.clone();
        caches.open(CACHE_NAME).then(function(cache) { cache.put(e.request, copy); });
        return res;
      })
      .catch(function() { return caches.match(e.request); })
  );
});
