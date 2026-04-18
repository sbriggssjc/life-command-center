const CACHE_NAME = 'lcc-v252';
const STATIC_ASSETS = [
  './',
  './index.html',
  './offline.html',
  './auth.js',
  './app.js',
  './styles.css',
  './ops.js',
  './gov.js',
  './dialysis.js',
  './detail.js',
  './contacts-ui.js',
  './manifest.json'
];

// Install: cache static shell (always skip waiting to activate immediately)
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate: clean old caches and claim clients immediately
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Network fetch with timeout — bypasses HTTP cache for same-origin JS/CSS/HTML
function fetchWithTimeout(request, timeoutMs, bypassCache) {
  var fetchOpts = bypassCache ? { cache: 'no-cache' } : {};
  return new Promise(function(resolve, reject) {
    var timedOut = false;
    var timer = setTimeout(function() {
      timedOut = true;
      reject(new Error('Network timeout'));
    }, timeoutMs);

    fetch(request, fetchOpts).then(function(response) {
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

  // Never intercept API calls — let the browser handle them directly
  if (url.pathname.startsWith('/api/')) return;

  // Network-first with 4s timeout for same-origin resources
  // Uses cache: 'no-cache' for JS/CSS/HTML to always revalidate with server
  // Falls back to SW cache if network is slow or unavailable (critical for mobile)
  if (url.origin === self.location.origin) {
    var isAppCode = /\.(js|css|html)$/.test(url.pathname) || url.pathname === '/' || url.pathname === './';
    event.respondWith(
      fetchWithTimeout(event.request, 4000, isAppCode)
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() =>
          caches.match(event.request).then(cached => {
            if (cached) return cached;
            // Navigation requests (HTML pages) get the offline fallback
            if (event.request.mode === 'navigate') return caches.match('./offline.html');
            return cached; // undefined — browser default error
          })
        )
    );
    return;
  }

  // External APIs: network with cache fallback (longer timeout)
  event.respondWith(
    fetchWithTimeout(event.request, 6000, false)
      .then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.re