/**
 * Progressive Web App helpers: service-worker registration and the login-screen
 * "Download App" suggestion banner.
 *
 * Uses `beforeinstallprompt` when the browser offers a native install prompt,
 * hides automatically in standalone mode or once installed, and falls back to
 * clear browser-menu instructions on browsers without `beforeinstallprompt`
 * (such as iOS Safari and Firefox).
 */

export function isStandaloneMode(win = globalThis.window) {
  if (!win) return false;

  if (win.navigator?.standalone === true) return true;

  if (typeof win.matchMedia === 'function') {
    for (const mode of ['standalone', 'fullscreen', 'window-controls-overlay']) {
      if (win.matchMedia(`(display-mode: ${mode})`)?.matches) return true;
    }
  }

  const referrer = win.document?.referrer || '';
  if (referrer.startsWith('android-app://')) return true;

  return false;
}

export function getManualInstallMessage(nav = globalThis.navigator) {
  const ua = String(nav?.userAgent || '');
  const platform = String(nav?.platform || '');
  const touchPoints = Number(nav?.maxTouchPoints || 0);

  const isIOS = /iPad|iPhone|iPod/i.test(ua)
    || (platform === 'MacIntel' && touchPoints > 1);

  if (isIOS) {
    return 'On iPhone or iPad: tap the Share button in Safari, then choose “Add to Home Screen”.';
  }

  const isMacSafari = /Macintosh|Mac OS X/i.test(ua)
    && /Safari/i.test(ua)
    && !/Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS/i.test(ua);

  if (isMacSafari) {
    return 'In Safari: choose File → “Add to Dock…”, or open your browser menu and select “Install app” / “Add to Home Screen”.';
  }

  return 'Open your browser menu (⋮) and choose “Install app” or “Add to Home Screen”.';
}

export function registerServiceWorker(win = globalThis.window) {
  const sw = win?.navigator?.serviceWorker;
  if (!sw || typeof sw.register !== 'function') return null;

  const register = () => sw.register('./sw.js').catch(() => null);

  if (win.document?.readyState === 'complete') {
    return register();
  }

  win.addEventListener?.('load', register, { once: true });
  return null;
}

export function mountPwaInstall({
  win = globalThis.window,
  doc = win?.document,
  onInstalled,
} = {}) {
  const banner = doc?.querySelector('#pwaInstallBanner') ?? null;
  const button = doc?.querySelector('#pwaInstallBtn') ?? null;
  const hint = doc?.querySelector('#pwaInstallHint') ?? null;

  let deferredPrompt = null;
  let installed = false;

  function hideHint() {
    if (hint) {
      hint.hidden = true;
      hint.textContent = '';
    }
    if (button) button.setAttribute('aria-expanded', 'false');
  }

  function showHint(message) {
    if (hint) {
      hint.textContent = message;
      hint.hidden = false;
    }
    if (button) button.setAttribute('aria-expanded', 'true');
  }

  function syncVisibility() {
    const visible = !installed && !isStandaloneMode(win);
    if (banner) banner.hidden = !visible;
    if (!visible) hideHint();
  }

  function handleBeforeInstallPrompt(event) {
    event.preventDefault?.();
    deferredPrompt = event;
    installed = false;
    hideHint();
    syncVisibility();
  }

  function handleAppInstalled() {
    deferredPrompt = null;
    installed = true;
    syncVisibility();
    onInstalled?.();
  }

  async function handleInstallClick() {
    if (installed || isStandaloneMode(win)) {
      syncVisibility();
      return;
    }

    if (deferredPrompt) {
      const promptEvent = deferredPrompt;
      deferredPrompt = null;
      hideHint();
      if (button) button.disabled = true;

      try {
        const promptResult = await promptEvent.prompt?.();
        const choice = promptEvent.userChoice ? await promptEvent.userChoice : promptResult;
        if (choice?.outcome === 'accepted') {
          installed = true;
          syncVisibility();
          onInstalled?.();
        }
      } catch {
        showHint(getManualInstallMessage(win?.navigator));
      } finally {
        if (button) button.disabled = false;
      }
      return;
    }

    showHint(getManualInstallMessage(win?.navigator));
  }

  win?.addEventListener?.('beforeinstallprompt', handleBeforeInstallPrompt);
  win?.addEventListener?.('appinstalled', handleAppInstalled);
  button?.addEventListener?.('click', handleInstallClick);

  const standaloneMedia = typeof win?.matchMedia === 'function'
    ? win.matchMedia('(display-mode: standalone)')
    : null;

  if (standaloneMedia?.addEventListener) {
    standaloneMedia.addEventListener('change', syncVisibility);
  } else if (standaloneMedia?.addListener) {
    standaloneMedia.addListener(syncVisibility);
  }

  syncVisibility();

  return {
    syncVisibility,
    hasDeferredPrompt: () => Boolean(deferredPrompt),
    destroy() {
      win?.removeEventListener?.('beforeinstallprompt', handleBeforeInstallPrompt);
      win?.removeEventListener?.('appinstalled', handleAppInstalled);
      button?.removeEventListener?.('click', handleInstallClick);
      if (standaloneMedia?.removeEventListener) {
        standaloneMedia.removeEventListener('change', syncVisibility);
      } else if (standaloneMedia?.removeListener) {
        standaloneMedia.removeListener(syncVisibility);
      }
    },
  };
}
