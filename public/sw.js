const CACHE_VERSION = 'ugmovies247-shell-v6';
const OFFLINE_URL = '/offline.html';
const NAVIGATION_PRECACHE_URLS = [OFFLINE_URL, '/downloads', '/siteicon.png', '/favicon.png'];
const DEFAULT_NOTIFICATION_ICON = '/siteicon.png';
const DEFAULT_NOTIFICATION_BADGE = '/favicon.png';
const BADGE_DB_NAME = 'ugmovies247-notifications';
const BADGE_STORE_NAME = 'badge-state';
const BADGE_COUNT_KEY = 'unread-count';

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
            .filter((key) => key !== CACHE_VERSION)
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

  const url = new URL(request.url);

  if (url.pathname !== '/downloads' && url.pathname !== '/downloads/') {
    return;
  }

  try {
    const cache = await caches.open(CACHE_VERSION);
    await cache.put(request, response.clone());
  } catch {
    // Navigation caching is best-effort only.
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') {
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
            (normalizedNavigationPath === '/downloads' || normalizedNavigationPath === '/downloads/'
              ? (await cache.match(request)) || (await cache.match('/downloads'))
              : null) ||
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

function readPushPayload(event) {
  if (!event.data) {
    return {};
  }

  try {
    return event.data.json();
  } catch {
    try {
      return { body: event.data.text() };
    } catch {
      return {};
    }
  }
}

function getPayloadRecord(payload) {
  return payload && typeof payload === 'object' ? payload : {};
}

function getPushData(payload) {
  const record = getPayloadRecord(payload);
  const data = getPayloadRecord(record.data);
  const notification = getPayloadRecord(record.notification);

  return { record, data, notification };
}

function getNotificationRoute(payload) {
  const { data } = getPushData(payload);
  const route = String(data.route || data.link || data.url || '').trim();
  const movieId = String(data.movieId || data.movie || '').trim();

  if (route) {
    return route;
  }

  if (movieId) {
    return `/movie/${encodeURIComponent(movieId)}?fresh=1&fromPush=1`;
  }

  return '/notifications';
}

function getUnreadCount(payload) {
  const { record, data } = getPushData(payload);
  const candidates = [
    record.unreadCount,
    record.badgeCount,
    record.badge,
    data.unreadCount,
    data.badgeCount,
    data.badge,
  ];

  for (const candidate of candidates) {
    const parsed = Number(candidate);

    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.floor(parsed);
    }
  }

  return null;
}

function openBadgeDb() {
  return new Promise((resolve) => {
    if (!self.indexedDB) {
      resolve(null);
      return;
    }

    const request = self.indexedDB.open(BADGE_DB_NAME, 1);

    request.onupgradeneeded = () => {
      request.result.createObjectStore(BADGE_STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

async function readStoredBadgeCount() {
  const db = await openBadgeDb();

  if (!db) {
    return 0;
  }

  return new Promise((resolve) => {
    const transaction = db.transaction(BADGE_STORE_NAME, 'readonly');
    const request = transaction.objectStore(BADGE_STORE_NAME).get(BADGE_COUNT_KEY);

    request.onsuccess = () => {
      const count = Number(request.result || 0);
      resolve(Number.isFinite(count) && count > 0 ? Math.floor(count) : 0);
    };
    request.onerror = () => resolve(0);
  });
}

async function writeStoredBadgeCount(count) {
  const db = await openBadgeDb();

  if (!db) {
    return;
  }

  await new Promise((resolve) => {
    const transaction = db.transaction(BADGE_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(BADGE_STORE_NAME);

    if (count > 0) {
      store.put(count, BADGE_COUNT_KEY);
    } else {
      store.delete(BADGE_COUNT_KEY);
    }

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => resolve();
  });
}

async function updateAppBadge(payload) {
  const explicitCount = getUnreadCount(payload);
  const count = explicitCount === null ? (await readStoredBadgeCount()) + 1 : explicitCount;

  await writeStoredBadgeCount(count);

  if (!self.navigator) {
    return;
  }

  try {
    if (count > 0 && typeof self.navigator.setAppBadge === 'function') {
      await self.navigator.setAppBadge(count);
    } else if (count <= 0 && typeof self.navigator.clearAppBadge === 'function') {
      await self.navigator.clearAppBadge();
    }
  } catch {
    // Badge support varies across browsers and WebViews.
  }
}

async function decrementAppBadge() {
  const count = Math.max(0, (await readStoredBadgeCount()) - 1);
  await writeStoredBadgeCount(count);

  if (!self.navigator) {
    return;
  }

  try {
    if (count > 0 && typeof self.navigator.setAppBadge === 'function') {
      await self.navigator.setAppBadge(count);
    } else if (count <= 0 && typeof self.navigator.clearAppBadge === 'function') {
      await self.navigator.clearAppBadge();
    }
  } catch {
    // Badge support varies across browsers and WebViews.
  }
}

async function notifyOpenClients(payload) {
  const clientList = await self.clients.matchAll({
    includeUncontrolled: true,
    type: 'window',
  });

  clientList.forEach((client) => {
    client.postMessage({
      type: 'ugmovies247:push',
      payload,
    });
  });
}

self.addEventListener('push', (event) => {
  const payload = readPushPayload(event);
  const { data, notification } = getPushData(payload);
  const title = String(notification.title || data.title || payload.title || 'UGMOVIES247');
  const body = String(
    notification.body ||
      data.body ||
      payload.body ||
      'A new movie or series is ready to watch.'
  );
  const image = String(notification.image || data.image || data.banner || data.poster || '').trim();
  const tag = String(data.tag || data.type || 'ugmovies247-update');

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, {
        body,
        icon: String(notification.icon || data.icon || DEFAULT_NOTIFICATION_ICON),
        badge: String(notification.badge || data.badgeIcon || DEFAULT_NOTIFICATION_BADGE),
        image: image || undefined,
        tag,
        renotify: true,
        data: {
          ...data,
          route: getNotificationRoute(payload),
        },
      }),
      updateAppBadge(payload),
      notifyOpenClients(payload),
    ])
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const route = String(event.notification.data?.route || '/notifications');
  const targetUrl = new URL(route, self.location.origin).toString();

  event.waitUntil(
    Promise.all([
      decrementAppBadge(),
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clientList) => {
        for (const client of clientList) {
          const clientUrl = new URL(client.url);

          if (clientUrl.origin !== self.location.origin) {
            continue;
          }

          if ('navigate' in client) {
            await client.navigate(targetUrl).catch(() => undefined);
          }

          if ('focus' in client) {
            return client.focus();
          }
        }

        return self.clients.openWindow(targetUrl);
      }),
    ])
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'ugmovies247:clear-badge') {
    return;
  }

  const clearBadge = async () => {
    await writeStoredBadgeCount(0);

    if (self.navigator && typeof self.navigator.clearAppBadge === 'function') {
      await self.navigator.clearAppBadge().catch(() => undefined);
    }
  };

  if (typeof event.waitUntil === 'function') {
    event.waitUntil(clearBadge());
  } else {
    void clearBadge();
  }
});
