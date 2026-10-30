/**
 * A very small Supabase client: auth (GoTrue) + PostgREST over fetch.
 *
 * No SDK, no build step. The publishable key is the only key in the browser.
 * Every table request carries the signed-in user's access token; Row Level
 * Security decides what that token can actually see or change.
 */
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SESSION_KEY, MIN_PASSWORD_LENGTH } from './config.js';

export class ApiError extends Error {
  constructor(message, { status = 0, code = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export function isOfflineError(error) {
  if (!error) return false;
  if (error instanceof ApiError) return error.status === 0;
  return error instanceof TypeError && /fetch|network/i.test(String(error.message || ''));
}

export function decodeJwtUser(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;

  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const bytes = Uint8Array.from(atob(padded), (ch) => ch.charCodeAt(0));
    const claims = JSON.parse(new TextDecoder().decode(bytes));
    if (!claims?.sub) return null;
    return {
      id: String(claims.sub),
      email: claims.email ? String(claims.email) : '',
    };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* session storage                                                     */
/* ------------------------------------------------------------------ */

function readStoredSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.access_token || !parsed?.refresh_token) return null;
    return parsed;
  } catch (error) {
    return null;
  }
}

let session = readStoredSession();
let refreshPromise = null;

export function getSession() {
  return session;
}

export function isSignedIn() {
  return Boolean(session?.access_token);
}

function persistSession(next) {
  session = next;
  try {
    if (next) localStorage.setItem(SESSION_KEY, JSON.stringify(next));
    else localStorage.removeItem(SESSION_KEY);
  } catch (error) {
    /* storage blocked (private mode): the tab keeps working from memory */
  }
}

function normalizeSession(payload) {
  if (!payload?.access_token) return null;
  return {
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
    expires_at: Number(payload.expires_at)
      || Math.floor(Date.now() / 1000) + Number(payload.expires_in || 3600),
    user: payload.user ?? decodeJwtUser(payload.access_token) ?? null,
  };
}

function cachedSessionUser() {
  if (!session) return null;
  if (session.user?.id) return session.user;
  return decodeJwtUser(session.access_token);
}

function tokenIsStale() {
  if (!session?.expires_at) return false;
  return session.expires_at * 1000 - Date.now() < 30_000;
}

/* ------------------------------------------------------------------ */
/* requests                                                            */
/* ------------------------------------------------------------------ */

function pickMessage(data, fallback) {
  if (!data) return fallback;
  if (typeof data === 'string') return data;
  return data.error_description || data.msg || data.message || data.error || fallback;
}

async function rawRequest(path, { method = 'GET', body, token, headers } = {}) {
  const bearer = token ?? session?.access_token ?? SUPABASE_PUBLISHABLE_KEY;
  const requestHeaders = {
    apikey: SUPABASE_PUBLISHABLE_KEY,
    Authorization: `Bearer ${bearer}`,
    ...headers,
  };
  if (body !== undefined) requestHeaders['Content-Type'] = 'application/json';

  let response;
  try {
    response = await fetch(`${SUPABASE_URL}${path}`, {
      method,
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw new ApiError('Can’t reach the server. Check your connection and try again.', { status: 0 });
  }

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (error) {
      data = text;
    }
  }

  return { response, data };
}

async function authRequest(path, { method = 'POST', body, token } = {}) {
  const { response, data } = await rawRequest(`/auth/v1${path}`, { method, body, token });
  if (!response.ok) {
    throw new ApiError(pickMessage(data, 'Something went wrong.'), {
      status: response.status,
      code: data?.error_code ?? null,
    });
  }
  return data;
}

async function apiRequest(path, { method = 'GET', body, headers, retried = false } = {}) {
  if (session && tokenIsStale()) {
    try {
      await refreshSession();
    } catch (error) {
      /* the 401 branch below owns the failure */
    }
  }

  const { response, data } = await rawRequest(path, { method, body, headers });

  if (response.status === 401 && session?.refresh_token && !retried) {
    try {
      await refreshSession();
    } catch (error) {
      if (isOfflineError(error)) throw error;
      persistSession(null);
      throw new ApiError('Your session has expired. Please sign in again.', { status: 401 });
    }
    return apiRequest(path, { method, body, headers, retried: true });
  }

  if (!response.ok) {
    throw new ApiError(pickMessage(data, `Request failed (${response.status}).`), {
      status: response.status,
      code: data?.code ?? data?.error_code ?? null,
    });
  }

  return data;
}

/* ------------------------------------------------------------------ */
/* auth                                                                */
/* ------------------------------------------------------------------ */

/** Picks up the tokens Supabase appends after an email confirmation link. */
export function adoptSessionFromUrl() {
  if (!location.hash || location.hash.length < 2) return null;

  const params = new URLSearchParams(location.hash.slice(1));
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (!accessToken || !refreshToken) return null;

  const next = normalizeSession({
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: params.get('expires_in'),
  });
  persistSession(next);
  return next;
}

export function readUrlError() {
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const query = new URLSearchParams(location.search);
  const raw = hash.get('error_description')
    || query.get('error_description')
    || hash.get('error')
    || null;
  return raw ? decodeURIComponent(raw.replace(/\+/g, ' ')) : null;
}

/** Drops session tokens (and any auth error message) from the address bar. */
export function clearAuthParamsFromUrl() {
  const url = new URL(location.href);
  let changed = false;

  if (url.hash) {
    url.hash = '';
    changed = true;
  }

  for (const key of ['error', 'error_code', 'error_description']) {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      changed = true;
    }
  }

  if (changed) history.replaceState(null, '', `${url.pathname}${url.search}`);
}

export async function signIn(email, password) {
  const data = await authRequest('/token?grant_type=password', { body: { email, password } });
  const next = normalizeSession(data);
  if (!next) throw new ApiError('Sign in failed. Please try again.');
  persistSession(next);
  return next;
}

export async function signUp(email, password) {
  const redirectTo = `${location.origin}${location.pathname}`;
  const data = await authRequest(`/signup?redirect_to=${encodeURIComponent(redirectTo)}`, {
    body: { email, password },
  });

  const next = normalizeSession(data);
  if (next) {
    persistSession(next);
    return { session: next, needsConfirmation: false };
  }

  return { session: null, needsConfirmation: true };
}

/**
 * Sends a recovery email. Resolves the same way whether or not the address has
 * an account, so the form cannot be used to discover who is registered.
 */
export async function requestPasswordReset(email) {
  const redirectTo = `${location.origin}${location.pathname}`;
  await authRequest(`/recover?redirect_to=${encodeURIComponent(redirectTo)}`, { body: { email } });
}

/** Sets a new password for the session a recovery link just opened. */
export async function updatePassword(password) {
  await apiRequest('/auth/v1/user', { method: 'PUT', body: { password } });
}

/** True when the page was opened from a password-recovery email. */
export function isRecoveryLink() {
  if (!location.hash || location.hash.length < 2) return false;
  return new URLSearchParams(location.hash.slice(1)).get('type') === 'recovery';
}

export async function signOut() {
  const token = session?.access_token;
  persistSession(null);
  if (!token) return;
  try {
    await authRequest('/logout', { token });
  } catch (error) {
    /* the local session is already gone, which is what matters here */
  }
}

export async function refreshSession() {
  if (!session?.refresh_token) throw new ApiError('Not signed in.', { status: 401 });
  if (refreshPromise) return refreshPromise;

  refreshPromise = authRequest('/token?grant_type=refresh_token', {
    body: { refresh_token: session.refresh_token },
  })
    .then((data) => {
      const next = normalizeSession(data);
      if (!next) throw new ApiError('Could not refresh the session.', { status: 401 });
      if (!next.user && session?.user) next.user = session.user;
      persistSession(next);
      return next;
    })
    .finally(() => {
      refreshPromise = null;
    });

  return refreshPromise;
}

/**
 * Confirms the stored token is still accepted by the server, or falls back to
 * the cached session user when the device is offline so the ledger opens
 * without a network connection.
 */
export async function getCurrentUser() {
  if (!session) return null;

  if (globalThis.navigator?.onLine === false) {
    const offlineUser = cachedSessionUser();
    if (offlineUser) return offlineUser;
  }

  try {
    if (tokenIsStale()) await refreshSession();
    const user = await apiRequest('/auth/v1/user');
    if (user?.id) {
      persistSession({ ...session, user });
    }
    return user;
  } catch (error) {
    if (isOfflineError(error)) {
      return cachedSessionUser();
    }
    if (error instanceof ApiError && (error.status === 400 || error.status === 401 || error.status === 403)) {
      persistSession(null);
    }
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* PostgREST                                                           */
/* ------------------------------------------------------------------ */

export function selectRows(table, query) {
  return apiRequest(`/rest/v1/${table}?${query}`);
}

export function insertRows(table, rows) {
  return apiRequest(`/rest/v1/${table}`, {
    method: 'POST',
    body: rows,
    headers: { Prefer: 'return=representation' },
  });
}

export function updateRows(table, query, patch) {
  return apiRequest(`/rest/v1/${table}?${query}`, {
    method: 'PATCH',
    body: patch,
    headers: { Prefer: 'return=representation' },
  });
}

export function deleteRows(table, query) {
  return apiRequest(`/rest/v1/${table}?${query}`, { method: 'DELETE' });
}

export function upsertRow(table, row, onConflict) {
  return apiRequest(`/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
    method: 'POST',
    body: row,
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
  });
}

/* ------------------------------------------------------------------ */
/* messages                                                            */
/* ------------------------------------------------------------------ */

export function describeAuthError(error) {
  const message = String(error?.message || '').toLowerCase();

  if (message.includes('invalid login credentials')) return 'That email and password don’t match an account.';
  if (message.includes('email not confirmed')) return 'Confirm your email first — the link is in your inbox.';
  if (message.includes('already registered') || message.includes('already been registered')) {
    return 'That email already has an account. Try signing in instead.';
  }
  if (message.includes('password') && (message.includes('least') || message.includes('weak'))) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (message.includes('rate limit') || message.includes('too many') || message.includes('for security purposes')) {
    return 'Too many attempts. Wait a minute, then try again.';
  }
  if (message.includes('unable to validate email') || message.includes('invalid email')) {
    return 'That email address doesn’t look right.';
  }
  if (message.includes('signups not allowed')) return 'New sign-ups are turned off for this project.';
  if (message.includes('fetch') || message.includes('network')) {
    return 'Can’t reach the server. Check your connection.';
  }

  return error?.message || 'Something went wrong. Try again.';
}

export function humanError(error, fallback = 'Something went wrong. Try again.') {
  if (error instanceof ApiError) {
    if (error.status === 0) return 'Can’t reach the server. Check your connection.';
    if (error.status === 401) return 'Your session expired. Please sign in again.';
    if (error.status === 403 || error.code === '42501') return 'This account isn’t allowed to change that entry.';
    if (error.status >= 500) return 'The server had a problem. Try again in a moment.';
    return error.message || fallback;
  }
  return error?.message || fallback;
}
