/* RC Heli Sim service worker: the sim keeps working at the field without signal.
   Hashed build assets are cached first-time and served from the cache forever (they never change);
   everything else same-origin (index.html, version.txt, ads) is network-first with the cache as fallback.
   Cross-origin requests (the rankings API, the logo bucket) are left alone. */
const CACHE = 'rc-heli-sim-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/index.html']).catch(() => undefined)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('rc-heli-sim-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.open(CACHE).then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) c.put(req, res.clone());
        return res;
      }),
    );
    return;
  }
  event.respondWith(
    caches.open(CACHE).then(async (c) => {
      try {
        const res = await fetch(req);
        if (res.ok) c.put(req, res.clone());
        return res;
      } catch {
        const hit = (await c.match(req)) ?? (req.mode === 'navigate' ? await c.match('/index.html') : undefined);
        return hit ?? new Response('Offline and not cached yet.', { status: 503, headers: { 'Content-Type': 'text/plain' } });
      }
    }),
  );
});
