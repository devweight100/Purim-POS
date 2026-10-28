const CACHE_NAME = 'purim-pos-shell-v2';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('purim-pos-') && key !== CACHE_NAME) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  // Business APIs and mutations must always reach the server/outbox, never HTTP cache.
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  const shell = request.mode === 'navigate' && url.pathname === '/pos';
  const asset = url.pathname.startsWith('/_next/static/') || /^\/icon/.test(url.pathname);
  if (!shell && !asset) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const response = await fetch(request);
      if (response.ok && !response.redirected) await cache.put(request, response.clone());
      return response;
    } catch {
      return await cache.match(request) || new Response('เปิดหน้านี้ครั้งแรกต้องเชื่อมต่อเซิร์ฟเวอร์ กรุณาลองใหม่เมื่อเชื่อมต่อได้', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  })());
});
