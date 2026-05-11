const CACHE_NAME = 'lcc-v287';
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
  './detail-lease-comps-fix.js',
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

  // Network-first with 4s timeout for same-origin resources.
  // For JS files we DO NOT cache the response — silently shadowing a
  // post-deploy code change with a stale cache hit (which we hit the
  // hard way in May 2026) is more painful than the modest benefit of
  // an offline JS fallback. Same rule applies to the lease-comps XLSX
  // template — a stale cached template silently strips the latest
  // headers/formulas from every export until the cache name bumps.
  // CSS/HTML/icons still cache for offline.
  if (url.origin === self.location.origin) {
    var isAppCode = /\.(js|css|html)$/.test(url.pathname) || url.pathname === '/' || url.pathname === './';
    var isJs = /\.js$/.test(url.pathname);
    var isXlsxTemplate = /\/cm-templates\/.*\.xlsx$/i.test(url.pathname);
    event.respondWith(
      fetchWithTimeout(event.request, 4000, isAppCode || isXlsxTemplate)
        .then(response => {
          if (response.ok && !isJs && !isXlsxTemplate) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => {
          // JS never gets a cache fallback either — fail loudly so the
          // user sees a real load error rather than silently running
          // last week's code.
          if (isJs) return new Response('// network error — refresh to retry', { status: 504, headers: { 'Content-Type': 'application/javascript' } });
          // XLSX templates also fail loudly: a stale cached template
          // would silently produce a wrong-looking export.
          if (isXlsxTemplate) return new Response('', { status: 504 });
          return caches.match(event.request).then(cached => {
            if (cached) return cached;
            if (event.request.mode === 'navigate') return caches.match('./offline.html');
            return cached;
          });
        })
    );
    return;
  }

  // External APIs: network with cache fallback (longer timeout)
  event.respondWith(
    fetchWithTimeout(event.request, 6000, false)
      .then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() =>
        caches.match(event.request).then(cached => cached || new Response('', { status: 504 }))
      )
  );
});
