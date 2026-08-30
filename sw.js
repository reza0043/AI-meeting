/* Chart DNA — Service Worker */
const VERSION = "chartdna-v2.11.0-remove-pattern-panels";
const CACHE_NAME = `${VERSION}`;
const PRECACHE_URLS = [
  "./",
  "index.html",
  "chart-ohlc-extractor.js?v=11",
  "chart-ohlc-engine.js?v=11",
  "chart-dna-ui-trim.js?v=11",
  "manifest.webmanifest",
  "icons/icon-192x192.png",
  "icons/icon-512x512.png",
  "icons/icon-180x180.png",
  "icons/icon-maskable-512x512.png",
];
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || !request.url.startsWith(self.location.origin)) return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request, { cache: "reload" }).then((response) => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      return response;
    }).catch(() => caches.match("index.html")));
    return;
  }
  event.respondWith(caches.match(request).then((cached) => {
    if (cached) return cached;
    return fetch(request).then((response) => {
      if (response && response.status === 200) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      }
      return response;
    });
  }));
});
