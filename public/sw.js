/* public/sw.js — the PWA service worker. Plain JS (NOT bundled by Vite): it is copied verbatim
   from public/ to the deploy root and registered by src/main.ts.

   Strategy — "cache for quick startup, server stays the source of truth for the version":
   - All same-origin GETs are served cache-first (instant boot, works offline), then refreshed in
     the background (stale-while-revalidate) so the cache trails the server by at most one load.
   - version.json is the ONE exception: it is NEVER cached, so the in-app update check always sees
     the server's real, current version. The game decides whether to prompt an update from it.
   - On an explicit update (the in-app "Update" / rail upgrade button) the page wipes every cache and
     reloads, so the next boot pulls a fresh index.html + freshly-hashed bundle. A save-breaking
     update clears the local save first (handled in the page, not here).
   Cross-origin requests (e.g. Google Fonts) are left to the browser. */

const CACHE = 'arena-runtime-v1';

self.addEventListener('install', () => {
  // Take over as soon as we're installed; the page also clears caches on an explicit update, so we
  // never want an old worker lingering in "waiting".
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Drop any caches from a previous worker revision, then control open pages immediately.
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

// The page asks us to drop everything right before it reloads to a new version.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'clear-caches') {
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))));
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // fonts/CDN: let the browser handle it

  // The version file is the server's live truth — always go to the network, never cache it.
  if (url.pathname.endsWith('/version.json')) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req);
      if (cached) {
        // Stale-while-revalidate: serve the cached copy now, refresh it in the background.
        event.waitUntil(
          fetch(req)
            .then((res) => {
              if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
            })
            .catch(() => {}),
        );
        return cached;
      }
      try {
        const res = await fetch(req);
        if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
        return res;
      } catch (err) {
        // Offline with nothing cached for this URL: fall back to the cached app shell for navigations.
        if (req.mode === 'navigate') {
          const shell =
            (await cache.match('index.html')) || (await cache.match('./index.html')) || (await cache.match('./'));
          if (shell) return shell;
        }
        throw err;
      }
    })(),
  );
});
