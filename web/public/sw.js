// Kill switch for the legacy Next.js/Workbox service worker.
//
// Older deployments shipped a Workbox SW that precached /_next/* assets. Those
// paths no longer exist in the Vite build, so returning users could keep getting
// stale/broken chunks. This replacement unregisters itself and clears every
// cache as soon as the browser checks for an update.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      } catch {
        // Cache API unavailable — nothing to clear.
      }
      try {
        await self.registration.unregister();
      } catch {
        // Already unregistered.
      }
      try {
        const clients = await self.clients.matchAll({ type: 'window' });
        for (const client of clients) {
          client.navigate(client.url).catch(() => {});
        }
      } catch {
        // No window clients.
      }
    })()
  );
});
