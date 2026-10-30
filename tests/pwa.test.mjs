import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

import {
  getManualInstallMessage,
  isStandaloneMode,
  mountPwaInstall,
  registerServiceWorker,
} from '../js/pwa.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readText = (relPath) => fs.readFileSync(path.join(ROOT, relPath), 'utf8');
const readBytes = (relPath) => fs.readFileSync(path.join(ROOT, relPath));

/* ------------------------------------------------------------------ */
/* 1. Manifest & relative paths                                       */
/* ------------------------------------------------------------------ */

test('manifest.json uses relative ./ paths so both GitHub Pages /Finora/ and Vercel / work', () => {
  const manifest = JSON.parse(readText('manifest.json'));

  assert.equal(manifest.short_name, 'Finora');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.id, './');
  assert.equal(manifest.background_color, '#ffffff');
  assert.equal(manifest.theme_color, '#ffffff');

  const pagesBase = 'https://101dave.github.io/Finora/manifest.json';
  const vercelBase = 'https://finora.vercel.app/manifest.json';
  assert.equal(new URL(manifest.start_url, pagesBase).pathname, '/Finora/');
  assert.equal(new URL(manifest.scope, pagesBase).pathname, '/Finora/');
  assert.equal(new URL(manifest.start_url, vercelBase).pathname, '/');
  assert.equal(new URL(manifest.scope, vercelBase).pathname, '/');

  const icons = manifest.icons;
  assert.equal(icons.length, 3);
  assert.ok(icons.some((icon) => icon.src === './icon-192.png' && icon.sizes === '192x192' && icon.purpose === 'any'));
  assert.ok(icons.some((icon) => icon.src === './icon-512.png' && icon.sizes === '512x512' && icon.purpose === 'any'));
  assert.ok(icons.some((icon) => icon.src === './icon-maskable-512.png' && icon.sizes === '512x512' && icon.purpose === 'maskable'));

  for (const icon of icons) {
    assert.ok(icon.src.startsWith('./'), `icon src should be relative: ${icon.src}`);
    assert.ok(fs.existsSync(path.resolve(ROOT, icon.src)), `missing icon file: ${icon.src}`);
    assert.equal(
      new URL(icon.src, pagesBase).pathname,
      `/Finora/${icon.src.slice(2)}`,
    );
  }
});

/* ------------------------------------------------------------------ */
/* 2. Monochrome PNG icons                                            */
/* ------------------------------------------------------------------ */

function inspectPng(buffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.deepEqual(buffer.subarray(0, 8), signature, 'valid PNG signature');
  assert.equal(buffer.subarray(12, 16).toString('ascii'), 'IHDR');

  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const bitDepth = buffer[24];
  const colorType = buffer[25];

  // Collect IDAT chunks and verify every pixel is strictly greyscale (R === G === B).
  const idatParts = [];
  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IDAT') idatParts.push(data);
    offset += 12 + length;
  }

  const raw = zlib.inflateSync(Buffer.concat(idatParts));
  assert.equal(bitDepth, 8);
  assert.equal(colorType, 6); // RGBA

  const stride = width * 4 + 1;
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * stride;
    assert.equal(raw[rowOffset], 0, 'uses filter type 0');
    for (let x = 0; x < width; x += 1) {
      const idx = rowOffset + 1 + x * 4;
      const r = raw[idx];
      const g = raw[idx + 1];
      const b = raw[idx + 2];
      assert.equal(r, g, `monochrome R===G at (${x},${y})`);
      assert.equal(g, b, `monochrome G===B at (${x},${y})`);
    }
  }

  return { width, height };
}

test('PWA and Apple touch icons have exact dimensions and a strictly monochrome palette', () => {
  const expected = [
    ['icon-192.png', 192, 192],
    ['icon-512.png', 512, 512],
    ['icon-maskable-512.png', 512, 512],
    ['apple-touch-icon.png', 180, 180],
  ];

  for (const [file, width, height] of expected) {
    const bytes = readBytes(file);
    assert.ok(bytes.length > 100 && bytes.length < 50 * 1024, `${file} has compact web size`);
    const info = inspectPng(bytes);
    assert.equal(info.width, width, `${file} width`);
    assert.equal(info.height, height, `${file} height`);
  }
});

/* ------------------------------------------------------------------ */
/* 3. HTML markup & responsive monochrome CSS                         */
/* ------------------------------------------------------------------ */

test('index.html links manifest/icons with ./ paths and places Download App banner below login card', () => {
  const html = readText('index.html');

  assert.match(html, /<link\s+rel="manifest"\s+href="\.\/manifest\.json"\s*\/?>/);
  assert.match(html, /<link\s+rel="apple-touch-icon"[^>]*href="\.\/apple-touch-icon\.png"\s*\/?>/);
  assert.match(html, /<link\s+rel="icon"[^>]*href="\.\/icon-192\.png"\s*\/?>/);

  // Every relative local href/src in index.html exists in the repo.
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((href) => !/^(?:https?:|data:|mailto:|#)/.test(href));
  for (const href of refs) {
    const target = href === './' ? 'index.html' : href;
    assert.ok(fs.existsSync(path.resolve(ROOT, target)), `index.html asset exists: ${href}`);
  }

  // Install suggestion box lives inside #authScreen, after .auth-card and before </section>.
  const authStart = html.indexOf('id="authScreen"');
  const appStart = html.indexOf('id="appScreen"');
  assert.ok(authStart > -1 && appStart > authStart);

  const authMarkup = html.slice(authStart, appStart);
  const cardIndex = authMarkup.indexOf('class="auth-card"');
  const bannerIndex = authMarkup.indexOf('id="pwaInstallBanner"');
  const buttonIndex = authMarkup.indexOf('id="pwaInstallBtn"');
  const footIndex = authMarkup.indexOf('class="auth-foot"');

  assert.ok(cardIndex > -1, 'auth-card present');
  assert.ok(bannerIndex > cardIndex, 'install banner sits below auth-card');
  assert.ok(buttonIndex > bannerIndex, 'Download App button sits inside install banner');
  assert.ok(footIndex > bannerIndex, 'install banner sits above auth footer');
  assert.match(authMarkup.slice(bannerIndex, footIndex), /<svg[\s\S]*?<\/svg>[\s\S]*?Download App/);
  assert.match(authMarkup.slice(bannerIndex, footIndex), /id="pwaInstallHint"/);
});

test('styles.css keeps the install banner monochrome and stacks cleanly on narrow phones', () => {
  const css = readText('styles.css');

  assert.doesNotMatch(css, /prefers-color-scheme:\s*dark/i);
  assert.match(css, /\.install-banner\s*\{[^}]*max-width:\s*424px/);
  assert.match(css, /@media\s*\(max-width:\s*560px\)[\s\S]*?\.install-banner-btn\s*\{\s*min-height:\s*42px/);
  assert.match(css, /@media\s*\(max-width:\s*400px\)[\s\S]*?\.install-banner-row\s*\{[^}]*flex-direction:\s*column/);
  assert.match(css, /@media\s*\(max-width:\s*400px\)[\s\S]*?\.install-banner-btn\s*\{\s*width:\s*100%/);
});

/* ------------------------------------------------------------------ */
/* 4. Service Worker behavior (app shell caching & Supabase bypass)   */
/* ------------------------------------------------------------------ */

function createSwHarness({
  swUrl = 'https://101dave.github.io/Finora/sw.js',
  networkImpl,
} = {}) {
  const listeners = new Map();
  const stores = new Map();

  const cacheApi = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const bucket = stores.get(name);
      return {
        async put(reqOrUrl, response) {
          const key = typeof reqOrUrl === 'string' ? reqOrUrl : reqOrUrl.url;
          bucket.set(key, response.clone());
        },
        async match(reqOrUrl) {
          const key = typeof reqOrUrl === 'string' ? reqOrUrl : reqOrUrl.url;
          return bucket.get(key)?.clone() ?? undefined;
        },
      };
    },
    async keys() {
      return [...stores.keys()];
    },
    async delete(name) {
      return stores.delete(name);
    },
    async match(reqOrUrl, options = {}) {
      const rawKey = typeof reqOrUrl === 'string' ? reqOrUrl : reqOrUrl.url;
      const targetKey = options.ignoreSearch ? rawKey.split('?')[0] : rawKey;
      for (const bucket of stores.values()) {
        for (const [storedUrl, response] of bucket.entries()) {
          const candidate = options.ignoreSearch ? storedUrl.split('?')[0] : storedUrl;
          if (candidate === targetKey) return response.clone();
        }
      }
      return undefined;
    },
  };

  let skippedWaiting = false;
  let claimedClients = false;
  const postedMessages = [];

  const selfObj = {
    location: new URL(swUrl),
    caches: cacheApi,
    skipWaiting() {
      skippedWaiting = true;
    },
    clients: {
      claim() {
        claimedClients = true;
      },
      async matchAll() {
        return [{ postMessage: (msg) => postedMessages.push(msg) }];
      },
    },
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
  };

  const context = vm.createContext({
    self: selfObj,
    caches: cacheApi,
    URL,
    Response,
    Headers,
    Request,
    AbortController,
    setTimeout,
    clearTimeout,
    fetch: (...args) => networkImpl(...args),
  });

  vm.runInContext(readText('sw.js'), context, { filename: 'sw.js' });

  return {
    stores,
    postedMessages,
    get skippedWaiting() {
      return skippedWaiting;
    },
    get claimedClients() {
      return claimedClients;
    },
    async dispatchInstall() {
      const waits = [];
      listeners.get('install')({ waitUntil: (p) => waits.push(p) });
      await Promise.all(waits);
    },
    async dispatchActivate() {
      const waits = [];
      listeners.get('activate')({ waitUntil: (p) => waits.push(p) });
      await Promise.all(waits);
    },
    async dispatchSync(tag) {
      const waits = [];
      listeners.get('sync')({ tag, waitUntil: (p) => waits.push(p) });
      await Promise.all(waits);
    },
    dispatchFetch(request) {
      let responsePromise = null;
      listeners.get('fetch')({
        request,
        respondWith(promise) {
          responsePromise = promise;
        },
      });
      return responsePromise;
    },
  };
}

test('sw.js caches every static app-shell file and works under both /Finora/ and /', async () => {
  const swSource = readText('sw.js');
  const shellMatch = swSource.match(/const APP_SHELL = \[([\s\S]*?)\];/);
  assert.ok(shellMatch, 'APP_SHELL list found');

  const assets = [...shellMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.ok(assets.length >= 18);

  // Every listed asset is relative and exists on disk.
  for (const asset of assets) {
    assert.ok(asset.startsWith('./'), `APP_SHELL entry uses ./ path: ${asset}`);
    const rel = asset === './' ? 'index.html' : asset;
    assert.ok(fs.existsSync(path.resolve(ROOT, rel)), `APP_SHELL file exists: ${asset}`);
  }

  // Every JS module in js/ is included in APP_SHELL so offline module graph never breaks.
  const jsFiles = [
    ...fs.readdirSync(path.join(ROOT, 'js'))
      .filter((name) => name.endsWith('.js'))
      .map((name) => `./js/${name}`),
    ...fs.readdirSync(path.join(ROOT, 'js/store'))
      .filter((name) => name.endsWith('.js'))
      .map((name) => `./js/store/${name}`),
  ];
  for (const mod of jsFiles) {
    assert.ok(assets.includes(mod), `APP_SHELL includes module ${mod}`);
  }

  // Run install + activate + offline fetch on GitHub Pages subpath (/Finora/).
  let online = true;
  const harness = createSwHarness({
    swUrl: 'https://101dave.github.io/Finora/sw.js',
    networkImpl: async (input) => {
      if (!online) throw new TypeError('Failed to fetch');
      const url = typeof input === 'string' ? input : input.url;
      return new Response(`body:${url}`, { status: 200 });
    },
  });

  // Seed an old cache to make sure activate cleans it up.
  await (await harness.stores.set('finora-shell-old', new Map()));
  await harness.dispatchInstall();
  await harness.dispatchActivate();

  assert.equal(harness.skippedWaiting, true);
  assert.equal(harness.claimedClients, true);
  assert.equal(harness.stores.has('finora-shell-old'), false);
  assert.equal(harness.stores.has('finora-shell-v2'), true);

  await harness.dispatchSync('finora-sync');
  assert.equal(harness.postedMessages.length, 1);
  assert.equal(harness.postedMessages[0].type, 'SYNC_NOW');

  // Go offline: shell CSS and subpath navigation still resolve from cache!
  online = false;
  const cssRes = await harness.dispatchFetch(
    new Request('https://101dave.github.io/Finora/styles.css', { method: 'GET' }),
  );
  assert.equal(cssRes.status, 200);
  assert.equal(await cssRes.text(), 'body:https://101dave.github.io/Finora/styles.css');

  // Navigation request in standalone mode falls back to cached /Finora/ shell.
  const navReq = {
    url: 'https://101dave.github.io/Finora/?utm_source=pwa',
    method: 'GET',
    mode: 'navigate',
    headers: new Headers(),
  };
  const navRes = await harness.dispatchFetch(navReq);
  assert.equal(navRes.status, 200);
  assert.equal(await navRes.text(), 'body:https://101dave.github.io/Finora/');
});

test('sw.js never intercepts or caches Supabase Auth or PostgREST requests', async () => {
  let networkCalls = 0;
  const harness = createSwHarness({
    swUrl: 'https://finora.vercel.app/sw.js',
    networkImpl: async () => {
      networkCalls += 1;
      return new Response('{}', { status: 200 });
    },
  });

  const mustBypass = [
    new Request('https://mexckxbopmgmklusegwo.supabase.co/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { apikey: 'sb_publishable_test' },
    }),
    new Request('https://mexckxbopmgmklusegwo.supabase.co/auth/v1/user', {
      method: 'GET',
      headers: { Authorization: 'Bearer token', apikey: 'sb_publishable_test' },
    }),
    new Request('https://mexckxbopmgmklusegwo.supabase.co/rest/v1/transactions?select=*', {
      method: 'GET',
      headers: { Authorization: 'Bearer token', apikey: 'sb_publishable_test' },
    }),
    new Request('https://mexckxbopmgmklusegwo.supabase.co/rest/v1/budgets?select=*', {
      method: 'GET',
    }),
    // Even if proxied on the same origin, Auth and PostgREST paths are bypassed:
    new Request('https://finora.vercel.app/auth/v1/user', { method: 'GET' }),
    new Request('https://finora.vercel.app/rest/v1/transactions?select=*', { method: 'GET' }),
    // Non-GET requests and sw.js itself are bypassed:
    new Request('https://finora.vercel.app/index.html', { method: 'POST' }),
    new Request('https://finora.vercel.app/sw.js', { method: 'GET' }),
  ];

  for (const req of mustBypass) {
    const intercepted = harness.dispatchFetch(req);
    assert.equal(intercepted, null, `sw.js must bypass ${req.method} ${req.url}`);
  }
  assert.equal(networkCalls, 0);
  assert.equal(harness.stores.size, 0);
});

/* ------------------------------------------------------------------ */
/* 5. Login-page Download App banner & install prompt behavior        */
/* ------------------------------------------------------------------ */

function createFakeDom({
  standalone = false,
  iosStandalone = false,
  userAgent = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36',
  platform = 'Linux armv8l',
  maxTouchPoints = 5,
} = {}) {
  const makeNode = () => {
    const attrs = new Map();
    const handlers = new Map();
    return {
      hidden: true,
      disabled: false,
      textContent: '',
      setAttribute(name, value) {
        attrs.set(name, String(value));
      },
      getAttribute(name) {
        return attrs.get(name) ?? null;
      },
      addEventListener(type, fn) {
        if (!handlers.has(type)) handlers.set(type, new Set());
        handlers.get(type).add(fn);
      },
      removeEventListener(type, fn) {
        handlers.get(type)?.delete(fn);
      },
      async click() {
        for (const fn of handlers.get('click') ?? []) {
          await fn({ type: 'click' });
        }
      },
    };
  };

  const banner = makeNode();
  const button = makeNode();
  button.hidden = false;
  const hint = makeNode();

  const doc = {
    readyState: 'complete',
    referrer: '',
    querySelector(selector) {
      if (selector === '#pwaInstallBanner') return banner;
      if (selector === '#pwaInstallBtn') return button;
      if (selector === '#pwaInstallHint') return hint;
      return null;
    },
  };

  let isStandalone = standalone;
  const mediaListeners = new Set();
  const winListeners = new Map();
  const registeredSw = [];

  const mql = {
    get matches() {
      return isStandalone;
    },
    addEventListener(type, fn) {
      if (type === 'change') mediaListeners.add(fn);
    },
    removeEventListener(type, fn) {
      if (type === 'change') mediaListeners.delete(fn);
    },
  };

  const win = {
    document: doc,
    navigator: {
      userAgent,
      platform,
      maxTouchPoints,
      standalone: iosStandalone,
      serviceWorker: {
        async register(scriptUrl) {
          registeredSw.push(scriptUrl);
          return { scope: './' };
        },
      },
    },
    matchMedia(query) {
      if (query === '(display-mode: standalone)') return mql;
      return { matches: false, addEventListener() {}, removeEventListener() {} };
    },
    addEventListener(type, fn) {
      if (!winListeners.has(type)) winListeners.set(type, new Set());
      winListeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      winListeners.get(type)?.delete(fn);
    },
    dispatch(type, event = {}) {
      for (const fn of winListeners.get(type) ?? []) fn(event);
    },
    setStandalone(next) {
      isStandalone = next;
      for (const fn of mediaListeners) fn({ matches: next });
    },
  };

  return { win, doc, banner, button, hint, registeredSw };
}

test('registerServiceWorker registers relative ./sw.js', async () => {
  const { win, registeredSw } = createFakeDom();
  await registerServiceWorker(win);
  assert.deepEqual(registeredSw, ['./sw.js']);
});

test('beforeinstallprompt triggers native install prompt on Download App click and hides when accepted', async () => {
  const { win, banner, button, hint } = createFakeDom({ standalone: false });
  let installedCount = 0;

  const pwa = mountPwaInstall({
    win,
    onInstalled: () => {
      installedCount += 1;
    },
  });

  // Visible immediately when not in standalone mode.
  assert.equal(banner.hidden, false);
  assert.equal(hint.hidden, true);

  let prevented = false;
  let prompted = 0;
  win.dispatch('beforeinstallprompt', {
    preventDefault() {
      prevented = true;
    },
    async prompt() {
      prompted += 1;
    },
    userChoice: Promise.resolve({ outcome: 'accepted' }),
  });

  assert.equal(prevented, true);
  assert.equal(pwa.hasDeferredPrompt(), true);

  await button.click();
  assert.equal(prompted, 1);
  assert.equal(banner.hidden, true, 'banner hides once user accepts native install');
  assert.equal(hint.hidden, true);
  assert.equal(installedCount, 1);

  pwa.destroy();
});

test('banner stays visible if user dismisses native prompt, and hides on appinstalled or standalone mode', async () => {
  const { win, banner, button } = createFakeDom({ standalone: false });
  const pwa = mountPwaInstall({ win });

  win.dispatch('beforeinstallprompt', {
    preventDefault() {},
    async prompt() {},
    userChoice: Promise.resolve({ outcome: 'dismissed' }),
  });

  await button.click();
  assert.equal(banner.hidden, false, 'banner stays visible when prompt is dismissed');

  // Transitioning to standalone display-mode hides the banner immediately.
  win.setStandalone(true);
  assert.equal(banner.hidden, true);

  win.setStandalone(false);
  assert.equal(banner.hidden, false);

  // appinstalled hides the banner permanently for the session.
  win.dispatch('appinstalled');
  assert.equal(banner.hidden, true);

  pwa.destroy();
});

test('banner stays hidden when launched in standalone mode (display-mode: standalone or iOS standalone)', () => {
  const androidStandalone = createFakeDom({ standalone: true });
  assert.equal(isStandaloneMode(androidStandalone.win), true);
  const pwa1 = mountPwaInstall({ win: androidStandalone.win });
  assert.equal(androidStandalone.banner.hidden, true);
  pwa1.destroy();

  const iosStandalone = createFakeDom({ standalone: false, iosStandalone: true });
  assert.equal(isStandaloneMode(iosStandalone.win), true);
  const pwa2 = mountPwaInstall({ win: iosStandalone.win });
  assert.equal(iosStandalone.banner.hidden, true);
  pwa2.destroy();
});

test('without beforeinstallprompt (iOS Safari & Firefox), Download App stays visible and shows clear menu instructions on click', async () => {
  // iOS Safari
  const ios = createFakeDom({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    platform: 'iPhone',
    maxTouchPoints: 5,
  });
  const iosPwa = mountPwaInstall({ win: ios.win });
  assert.equal(ios.banner.hidden, false, 'Download App banner is visible on iOS Safari');
  assert.equal(ios.hint.hidden, true);

  await ios.button.click();
  assert.equal(ios.hint.hidden, false, 'clicking Download App reveals instructions');
  assert.match(ios.hint.textContent, /Share/i);
  assert.match(ios.hint.textContent, /Add to Home Screen/i);
  assert.equal(ios.button.getAttribute('aria-expanded'), 'true');
  iosPwa.destroy();

  // Firefox Android / Desktop
  const firefox = createFakeDom({
    userAgent: 'Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0',
    platform: 'Linux armv8l',
    maxTouchPoints: 5,
  });
  const ffPwa = mountPwaInstall({ win: firefox.win });
  assert.equal(firefox.banner.hidden, false, 'Download App banner is visible on Firefox');

  await firefox.button.click();
  assert.equal(firefox.hint.hidden, false);
  assert.match(firefox.hint.textContent, /Install app/i);
  assert.match(firefox.hint.textContent, /Add to Home Screen/i);
  ffPwa.destroy();

  // iPadOS desktop-class UA detection
  const ipadMsg = getManualInstallMessage({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15',
    platform: 'MacIntel',
    maxTouchPoints: 5,
  });
  assert.match(ipadMsg, /Add to Home Screen/);
});
