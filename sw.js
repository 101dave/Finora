/**
 * Finora — static app-shell service worker.
 *
 * Caches only the static frontend shell so Finora is installable and opens
 * reliably on slow or offline connections. Supabase Auth (/auth/v1) and
 * PostgREST (/rest/v1) requests always go straight to the network and are
 * never cached here.
 */

const CACHE_NAME = 'finora-shell-v1';

const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
  './vendor/chart.umd.js',
  './js/app.js',
  './js/auth.js',
  './js/categories.js',
  './js/chart.js',
  './js/config.js',
  './js/dashboard.js',
  './js/dom.js',
  './js/format.js',
  './js/pwa.js',
  './js/supabase-rest.js',
  './js/toast.js',
  './js/store/supabase-store.js',
];

function shellPathnames() {
  return new Set(APP_SHELL.map((asset) => new URL(asset, self.location.href).pathname));
}

function shouldBypass(request, url) {
  if (request.method !== 'GET') return true;
  if (request.headers.has('Authorization') || request.headers.has('apikey')) return true;
  if (url.origin !== self.location.origin) return true;
  if (url.hostname.includes('supabase.co')) return true;
  if (url.pathname.includes('/auth/v1') || url.pathname.includes('/rest/v1')) return true;
  return false;
}

async function cleanRedirectedResponse(response) {
  if (!response.redirected) return response;
  const body = await response.blob();
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

async function precacheShell() {
  const cache = await caches.open(CACHE_NAME);
  await Promise.all(
    APP_SHELL.map(async (asset) => {
      try {
        const target = new URL(asset, self.location.href).href;
        const response = await fetch(target, { cache: 'reload' });
        if (!response.ok) return;
        await cache.put(target, await cleanRedirectedResponse(response));
      } catch {
        /* offline or transient failure during install */
      }
    }),
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(precacheShell());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
    )),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (shouldBypass(request, url)) return;

  const isNavigation = request.mode === 'navigate';
  const isShellAsset = shellPathnames().has(url.pathname);
  if (!isNavigation && !isShellAsset) return;

  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (response && response.status === 200 && response.type === 'basic') {
        const clean = await cleanRedirectedResponse(response);
        if (isShellAsset) {
          const copy = clean.clone();
          const cacheKey = isNavigation ? new URL('./', self.location.href).href : request;
          caches.open(CACHE_NAME).then((cache) => cache.put(cacheKey, copy)).catch(() => {});
        }
        return clean;
      }
      return response;
    } catch {
      const cached = await caches.match(request, { ignoreSearch: isNavigation });
      if (cached) return cached;

      if (isNavigation) {
        const rootFallback = await caches.match(new URL('./', self.location.href).href);
        if (rootFallback) return rootFallback;
        const indexFallback = await caches.match(new URL('./index.html', self.location.href).href);
        if (indexFallback) return indexFallback;
      }

      return new Response('Offline', { status: 503, statusText: 'Offline' });
    }
  })());
});
