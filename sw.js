/* Chart DNA — Service Worker
 * Enables installability (add to home screen) + offline support
 * for the client-side engine. The app has no server dependency for
 * its core pattern-matching features, so it can cache everything.
 */
const VERSION = "chartdna-v1.2.0";
const CACHE_NAME = `${VERSION}`;

// Core app shell to precache. Everything else (icons, fonts) is
// cached at runtime. Vite hashes assets in production (`/assets/...`),
// so those are handled by the runtime cache entry below.
// URLs are RELATIVE so the scope resolves under the site sub-path.
const ROOT = "./";
const PRECACHE_URLS = [
  ROOT,
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

// Activate: clean up old cache versions.
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

// Runtime caching: cache-first for immutable hashed assets,
// network-first (fallback to cache) for navigations & HTML.
self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only handle GET & same-origin requests.
  if (request.method !== "GET" || !request.url.startsWith(self.location.origin)) {
    return;
  }

  // For document navigations (page loads): ALWAYS fetch the freshest HTML,
  // bypassing the CDN's HTTP cache (GitHub Pages sends max-age=600 for
  // index.html, which would otherwise keep serving the OLD page for 10 min).
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

  // For non-navigation (assets, fonts, etc.): cache-first.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        // Cache successful same-origin responses & Google Fonts.
        if (response && response.status === 200) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});
