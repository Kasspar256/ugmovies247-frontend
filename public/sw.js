const CACHE_VERSION = 'ugmovies247-shell-v4';
const IMAGE_CACHE_VERSION = `${CACHE_VERSION}-images`;
const OFFLINE_URL = '/offline.html';
const NAVIGATION_PRECACHE_URLS = [OFFLINE_URL, '/downloads', '/siteicon.png', '/favicon.png'];

function getNextStaticAssetsFromHtml(html) {
  const assets = new Set();
  const pattern = /(?:src|href)=["']([^"']*\/_next\/static\/[^"']+)["']/g;
  let match = pattern.exec(html);

  while (match) {
    assets.add(new URL(match[1], self.location.origin).toString());
    match = pattern.exec(html);
  }

  return Array.from(assets);
}

async function precacheNavigationWithAssets(cache, url) {
  const response = await fetch(url, { credentials: 'same-origin' });

  if (!response.ok) {
    return;
  }

  await cache.put(url, response.clone());

  if (!String(response.headers.get('content-type') || '').includes('text/html')) {
    return;
  }

  const html = await response.clone().text();
  const assets = getNextStaticAssetsFromHtml(html);
  await Promise.all(assets.map((assetUrl) => cache.add(assetUrl).catch(() => undefined)));
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) =>
        Promise.all(
          NAVIGATION_PRECACHE_URLS.map((url) =>
            url.startsWith('/_next') || url.includes('.')
              ? cache.add(url).catch(() => undefined)
              : precacheNavigationWithAssets(cache, url).catch(() => undefined)
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_VERSION && key !== IMAGE_CACHE_VERSION)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

async function cacheSuccessfulNavigation(request, response) {
  if (!response || !response.ok || response.type === 'opaque') {
    return;
  }

  try {
    const cache = await caches.open(CACHE_VERSION);
    await cache.put(request, response.clone());
  } catch {
    // Navigation caching is best-effort only.
  }
}

function isImageRequest(request) {
  if (request.destination === 'image') {
    return true;
  }

  const accept = request.headers.get('accept') || '';
  return accept.includes('image/');
}

async function cacheFirstImage(request) {
  const cache = await caches.open(IMAGE_CACHE_VERSION);
  const cachedResponse = await cache.match(request, { ignoreVary: true });

  if (cachedResponse) {
    return cachedResponse;
  }

  const response = await fetch(request);

  if (response && (response.ok || response.type === 'opaque')) {
    await cache.put(request, response.clone()).catch(() => undefined);
  }

  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') {
    return;
  }

  if (isImageRequest(request)) {
    event.respondWith(
      cacheFirstImage(request).catch(async () => {
        const cache = await caches.open(IMAGE_CACHE_VERSION);
        return (await cache.match(request, { ignoreVary: true })) || Response.error();
      })
    );
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          void cacheSuccessfulNavigation(request, response);
          return response;
        })
        .catch(async () => {
          const cache = await caches.open(CACHE_VERSION);
          const url = new URL(request.url);
          const normalizedNavigationPath = url.pathname;

          return (
            (await cache.match(request)) ||
            (normalizedNavigationPath === '/downloads' || normalizedNavigationPath === '/downloads/'
              ? await cache.match('/downloads')
              : null) ||
            (await cache.match('/browse')) ||
            (await cache.match('/')) ||
            (await cache.match(OFFLINE_URL)) ||
            new Response(
              '<!doctype html><title>UGMOVIES247 offline</title><body style="margin:0;background:#0B0C10;color:white;font-family:system-ui;display:grid;place-items:center;min-height:100vh;text-align:center;padding:24px"><main><h1>Connection paused</h1><p>Reconnect and try again.</p></main></body>',
              { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 503 }
            )
          );
        })
    );
    return;
  }

  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    return;
  }

  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/siteicon.png' ||
    url.pathname === '/favicon.png'
  ) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }

        return fetch(request).then((response) => {
          if (response.ok) {
            const responseForCache = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, responseForCache));
          }

          return response;
        });
      })
    );
  }
});
