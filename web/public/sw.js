const CACHE_PREFIX = 'tech-growth-hub-shell-';
const CACHE_NAME = `${CACHE_PREFIX}v5`;
const SHELL_URLS = ['/manifest.webmanifest', '/app-icon.svg'];

async function fetchAndCache(cache, url) {
  const response = await fetch(new Request(url, { cache: 'reload' }));
  if (!response.ok) throw new Error(`Unable to precache ${url}: ${response.status}`);
  await cache.put(url, response);
}

async function precacheShell() {
  const cache = await caches.open(CACHE_NAME);
  await Promise.all(SHELL_URLS.map((url) => fetchAndCache(cache, url)));
  const response = await fetch(new Request('/', { cache: 'reload' }));
  if (!response.ok) throw new Error(`Unable to precache app shell: ${response.status}`);
  await cache.put('/', response.clone());
  const html = await response.text();
  const assetUrls = Array.from(html.matchAll(/(?:src|href)="(\/assets\/[^"?]+)"/g), (match) => match[1]);
  const uniqueAssets = Array.from(new Set(assetUrls));
  if (uniqueAssets.length > 0) {
    await Promise.all(uniqueAssets.map((url) => fetchAndCache(cache, url)));
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(precacheShell().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          if (response.ok && response.headers.get('Content-Type')?.includes('text/html')) {
            try {
              const cache = await caches.open(CACHE_NAME);
              await cache.put('/', response.clone());
            } catch { /* A cache write failure must not replace a valid online response. */ }
          }
          return response;
        })
        .catch(async () => {
          const cache = await caches.open(CACHE_NAME);
          return await cache.match('/') || new Response('离线页面暂不可用，请联网后重试。', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          });
        })
    );
    return;
  }

  if (['script', 'style', 'font', 'image'].includes(request.destination)) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => await cache.match(request, { ignoreVary: true }) || fetch(request).then(async (response) => {
        if (response.ok) {
          try { await cache.put(request, response.clone()); } catch { /* The network response remains usable. */ }
        }
        return response;
      }))
    );
  }
});
