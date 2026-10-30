/**
 * Bootstrap: pick a screen (auth, dashboard, or demo) and wire the theme.
 */
import { $, show } from './dom.js';
import { IS_CONFIGURED } from './config.js';
import { initTheme, toggleTheme } from './theme.js';
import { mountAuth } from './auth.js';
import { mountDashboard } from './dashboard.js';
import { createLocalStore } from './store/local-store.js';
import { createSupabaseStore } from './store/supabase-store.js';
import {
  adoptSessionFromUrl,
  clearAuthParamsFromUrl,
  getCurrentUser,
  isSignedIn,
  readUrlError,
  signOut,
} from './supabase-rest.js';

const DEMO = new URLSearchParams(location.search).get('demo') === '1';

let dashboard = null;

function showScreen(name) {
  show($('#loading'), false);
  show($('#authScreen'), name === 'auth');
  show($('#appScreen'), name === 'app');
}

function setupThemeButtons() {
  for (const button of document.querySelectorAll('#themeBtn, #authThemeBtn')) {
    button.addEventListener('click', () => toggleTheme());
  }
}

function startDemo() {
  dashboard = mountDashboard({
    store: createLocalStore(),
    user: null,
    demo: true,
    onSignOut: exitDemo,
  });
  showScreen('app');
  dashboard.start();
}

function exitDemo() {
  location.href = location.pathname;
}

function startCloud(user) {
  dashboard = mountDashboard({
    store: createSupabaseStore(),
    user,
    demo: false,
    onSignOut: handleSignOut,
  });
  showScreen('app');
  dashboard.start();
}

async function handleSignOut() {
  dashboard?.destroy();
  await signOut();
  location.replace(location.pathname);
}

function startAuth(message = '') {
  mountAuth({
    initialMessage: message,
    onSignedIn: () => location.replace(location.pathname),
  });
  showScreen('auth');
}

async function boot() {
  initTheme();
  setupThemeButtons();
  show($('#loading'), true);

  // Email confirmation links come back with tokens in the hash.
  const adopted = adoptSessionFromUrl();
  const urlError = readUrlError();
  if (adopted || urlError || location.hash) clearAuthParamsFromUrl();

  if (DEMO) {
    startDemo();
    return;
  }

  if (!IS_CONFIGURED) {
    startAuth('Finora isn’t connected to Supabase yet. Add your project URL and publishable key to js/config.js.');
    return;
  }

  if (isSignedIn()) {
    const user = await getCurrentUser();
    if (user) {
      startCloud(user);
      return;
    }
  }

  startAuth(urlError ? `That sign-in link didn’t work: ${urlError}` : '');
}

boot().catch((error) => {
  console.error(error);
  startAuth('Finora hit a problem while starting. Reload the page and try again.');
});
