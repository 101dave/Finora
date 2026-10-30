/**
 * Bootstrap: pick a screen (auth or dashboard).
 */
import { $, show } from './dom.js';
import { IS_CONFIGURED } from './config.js';
import { mountAuth } from './auth.js';
import { mountDashboard } from './dashboard.js';
import { createSupabaseStore } from './store/supabase-store.js';
import {
  adoptSessionFromUrl,
  clearAuthParamsFromUrl,
  getCurrentUser,
  isSignedIn,
  readUrlError,
  signOut,
} from './supabase-rest.js';

let dashboard = null;

function showScreen(name) {
  show($('#loading'), false);
  show($('#authScreen'), name === 'auth');
  show($('#appScreen'), name === 'app');
}

function startCloud(user) {
  dashboard = mountDashboard({
    store: createSupabaseStore(),
    user,
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
  show($('#loading'), true);

  // Email confirmation links come back with tokens in the hash.
  const adopted = adoptSessionFromUrl();
  const urlError = readUrlError();
  if (adopted || urlError || location.hash) clearAuthParamsFromUrl();

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
