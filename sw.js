const CACHE_NAME = 'lcc-v113';
const STATIC_ASSETS = [
  './',
  './index.html',
  './app.js',
  './styles.css',
  './ops.js',
  './gov.js',
  './dialysis.js',
  './detail.js',
  './manifest.json'
];

// Install: cache static shell
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate: clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Network fetch with timeout — falls back to cache if network is slow or fails
function fetchWithTimeout(request, timeoutMs) {
  return new Promise(function(resolve, reject) {
    var timedOut = false;
    var timer = setTimeout(function() {
      timedOut = true;
      reject(new Error('Network timeout'));
    }, timeoutMs);

    fetch(request).then(function(response) {
      if (!timedOut) {
        clearTimeout(timer);
        resolve(response);
      }
    }).catch(function(err) {
      if (!timedOut) {
        clearTimeout(timer);
        reject(err);
      }
    });
  });
}

// Fetch handler
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Skip non-GET requests (POST to APIs, etc.)
  if (event.request.method !== 'GET') return;

  // Network-first with 4s timeout for same-origin resources
  // Falls back to cache if network is slow or unavailable (critical for mobile)
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetchWithTimeout(event.request, 4000)
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // External APIs: network with cache fallback (longer timeout)
  event.respondWith(
    fetchWithTimeout(event.request, 6000)
      .then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
