/* QR Scout service worker: cache-first app shell so Chrome can offer
   "Install QR Scout" (PWA install requires a service worker + manifest). */
const CACHE = "qrscout-shell-v5";
const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./assets/css/styles.css",
  "./assets/js/app.js",
  "./assets/js/qrcode.min.js",
  "./assets/images/millerbot-orange.png"
];

// Network timeout for fetch requests inside the SW so a dead network
// doesn't stall the install/activate flow.
function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("sw-timeout")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Navigations: network-first (fresh UI), fall back to the cached shell offline.
// Other shell assets: stale-while-revalidate — serve the cache instantly, then
// refresh it in the background so code/CSS updates propagate without a hard
// reload or a manual CACHE bump. This keeps index.html and app.js in step.
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // let cross-origin requests pass through

  if (request.mode === "navigate") {
    event.respondWith(
      withTimeout(fetch(request), 10000)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put("./index.html", copy));
          return response;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((hit) => {
      const network = withTimeout(fetch(request), 10000)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => hit);
      return hit || network;
    })
  );
});
