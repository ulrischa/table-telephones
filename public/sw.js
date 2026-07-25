const CACHE_NAME = "table-telephones-v1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./assets/app.js",
  "./assets/app.css",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

function scopedUrl(path) {
  return new URL(path, self.registration.scope).href;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL.map(scopedUrl)))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("table-telephones-") && key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);
  const scope = new URL(self.registration.scope);

  if (url.origin !== scope.origin) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            await cache.put(scopedUrl("./index.html"), response.clone());
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(scopedUrl("./index.html"));
          return cached ?? Response.error();
        }),
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then(async (response) => {
        if (response.ok && response.type === "basic") {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, response.clone());
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        return cached ?? Response.error();
      }),
  );
});
