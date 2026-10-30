/**
 * Finora — configuration
 *
 * Only the publishable ("anon") key belongs in the browser.
 * Row Level Security in Postgres is what actually protects the data;
 * the key grants nothing on its own.
 */
export const SUPABASE_URL = 'https://mexckxbopmgmklusegwo.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_darDcvAXKLgfD-LXY929jQ_4PFpf03t';

export const SESSION_KEY = 'finora.session.v1';
export const THEME_KEY = 'finora.theme';

export const APP_NAME = 'Finora';
export const CURRENCY = { locale: 'en-PH', code: 'PHP', symbol: '₱' };

/** Matches the numeric(12,2) ceiling enforced by the database. */
export const MAX_AMOUNT = 999999999.99;
export const MAX_NOTE_LENGTH = 200;
export const MIN_PASSWORD_LENGTH = 6;

export const IS_CONFIGURED = Boolean(
  SUPABASE_URL &&
  SUPABASE_PUBLISHABLE_KEY &&
  !SUPABASE_URL.includes('YOUR-PROJECT') &&
  !SUPABASE_PUBLISHABLE_KEY.includes('YOUR-KEY'),
);
