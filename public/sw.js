const CACHE = "pit-unit-v2";
const SCOPE_PATH = new URL(self.registration.scope).pathname.replace(/\/$/, "");
const scopedPath = (path) => `${SCOPE_PATH}${path.startsWith("/") ? path : `/${path}`}` || "/";
const APP_SHELL = [scopedPath("/"), scopedPath("/manifest.webmanifest"), scopedPath("/favicon.svg")];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(fetch(event.request).then((response) => {
    if (response.ok && new URL(event.request.url).origin === location.origin) {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(event.request, copy));
    }
    return response;
  }).catch(() => caches.match(event.request).then((cached) => cached || caches.match(scopedPath("/")))));
});
