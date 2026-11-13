/* Service worker for the public link: keeps the app (one HTML file) and its fonts available offline.
   Page loads use the network when it answers and fall back to the cached copy; fonts are cache-first. */
const CACHE = "chordscroll-app";
const VERSION = "ea0d2effc130";
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.add(new Request("./", { cache: "reload" }))).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const sameApp = url.origin === location.origin && (url.pathname.endsWith("/") || url.pathname.endsWith("/index.html"));
  if (sameApp && req.mode === "navigate") {
    e.respondWith(fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put("./", copy)); }
      return res;
    }).catch(() => caches.match("./")));
    return;
  }
  if (/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res; })));
  }
});
