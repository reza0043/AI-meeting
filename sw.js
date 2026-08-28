/* Chart DNA — Service Worker
 * Enables installability (add to home screen) + offline support
 * for the client-side engine.
 *
 * Strategy summary:
 *  - HTML navigations are ALWAYS fetched fresh (cache:"reload") so users
 *    never get stuck on a stale page. Falls back to cached shell offline.
 *  - HASSED assets (JS/CSS/icons) use cache-first (they get a new filename
 *    on every build, so they can never go stale).
 *  - On activation, any cache from an older version is deleted automatically,
 *    so users always get the latest build without touching site data.
 */
const VERSION = "chartdna-v1.9.0";
const CACHE_NAME = `${VERSION}`;

// Core app shell to precache. URLs are RELATIVE so the scope resolves
// under the site sub-path (/AI-meeting/).
const PRECACHE_URLS = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "icons/icon-192x192.png",
  "icons/icon-512x512.png",
  "icons/icon-180x180.png",
  "icons/icon-maskable-512x512.png",
];

// Install: precache the app shell & claim clients.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// Activate: clean up the OLD cache version (so a new build is always used).
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== CACHE_NAME)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

// Runtime caching.
self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only handle GET & same-origin requests.
  if (request.method !== "GET" || !request.url.startsWith(self.location.origin)) {
    return;
  }

  // For document navigations: ALWAYS fetch the freshest HTML, bypassing the
  // CDN's HTTP cache (GitHub Pages serves max-age=600 for index.html, which
  // would otherwise keep serving the OLD page for 10 min). Fall back to cache.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request, { cache: "reload" })
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match("index.html"))
    );
    return;
  }

  // For non-navigation assets: cache-first (hashed files never go stale).
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response && response.status === 200) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});
