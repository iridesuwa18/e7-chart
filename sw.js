/* E7 Draft — service worker
   Bump CACHE_NAME any time you change index.html / app.js / style.css,
   otherwise Android may keep serving the old cached versions even after
   you push new files to GitHub. */
const CACHE_NAME = "e7-draft-v3";

const SHELL_FILES = [
  "./index.html",
  "./quickdraft.html",
  "./style.css",
  "./app.js",
  "./manifest.json",
  "./manifest-quickdraft.json",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-192-qd.png",
  "./icon-512-qd.png",
];

// Never cache calls to the live data API — Quick Draft should always see
// your latest roster, not a stale offline snapshot.
const NEVER_CACHE_HOSTS = ["e7-chart.vercel.app"];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);

  // Live data API — always go to the network, never serve/cache a stale copy.
  if (NEVER_CACHE_HOSTS.some(host => url.hostname.includes(host))) {
    event.respondWith(fetch(event.request).catch(() => new Response(null, { status: 503 })));
    return;
  }

  if (event.request.method !== "GET") return;

  // App shell — stale-while-revalidate: instant load from cache, then
  // quietly refresh the cache in the background for next time.
  event.respondWith(
    caches.match(event.request).then(cached => {
      const networkFetch = fetch(event.request)
        .then(res => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});
