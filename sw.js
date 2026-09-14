/* E7 Draft — service worker
   Bump CACHE_NAME any time you change index.html / app.js / style.css,
   otherwise Android may keep serving the old cached versions even after
   you push new files to GitHub. */
const CACHE_NAME = "e7-draft-v5";

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

// Files where correctness matters more than instant load — always try the
// network first so a running app (e.g. a Quick Draft home-screen shortcut
// that just gets resumed by a launcher instead of freshly navigated) picks
// up fixes the moment it's back online, instead of quietly re-serving
// whatever was cached from before the fix shipped. Falls back to cache
// only when the network is unreachable (offline).
const NETWORK_FIRST_FILES = new Set([
  "index.html", "quickdraft.html", "app.js", "manifest.json", "manifest-quickdraft.json",
]);
const NETWORK_FIRST_TIMEOUT_MS = 3000;

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

function isNetworkFirst(url) {
  // Treat "/" and "" as index.html (root navigations).
  const path = url.pathname.split("/").pop() || "index.html";
  return NETWORK_FIRST_FILES.has(path) || url.pathname.endsWith("/");
}

function networkFirst(request) {
  return new Promise(resolve => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      caches.match(request).then(cached => resolve(cached || fetch(request)));
    }, NETWORK_FIRST_TIMEOUT_MS);

    fetch(request).then(res => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
      }
      resolve(res);
    }).catch(() => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      caches.match(request).then(cached => {
        resolve(cached || new Response(null, { status: 503 }));
      });
    });
  });
}

function staleWhileRevalidate(request) {
  return caches.match(request).then(cached => {
    const networkFetch = fetch(request)
      .then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        }
        return res;
      })
      .catch(() => cached);
    return cached || networkFetch;
  });
}

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);

  // Live data API — always go to the network, never serve/cache a stale copy.
  if (NEVER_CACHE_HOSTS.some(host => url.hostname.includes(host))) {
    event.respondWith(fetch(event.request).catch(() => new Response(null, { status: 503 })));
    return;
  }

  if (event.request.method !== "GET") return;

  // App shell HTML/JS/manifests — network-first, so a resumed/backgrounded
  // instance (e.g. relaunched via a launcher popup) always tries to fetch
  // the latest code first, and only falls back to cache when offline.
  if (event.request.mode === "navigate" || isNetworkFirst(url)) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // Everything else (icons, fonts, etc.) — instant load from cache, quietly
  // refreshed in the background for next time.
  event.respondWith(staleWhileRevalidate(event.request));
});
