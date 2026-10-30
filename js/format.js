/**
 * Formatting and date helpers.
 *
 * Dates are handled as plain `YYYY-MM-DD` strings all the way through, and are
 * only turned into Date objects in local time. Parsing with `new Date('2026-10-01')`
 * would be UTC and would shift the day for anyone west of Greenwich, so we never do.
 */
import { CURRENCY, MAX_AMOUNT } from './config.js';

const moneyFull = new Intl.NumberFormat(CURRENCY.locale, {
  style: 'currency',
  currency: CURRENCY.code,
  currencyDisplay: 'narrowSymbol',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const moneyWhole = new Intl.NumberFormat(CURRENCY.locale, {
  style: 'currency',
  currency: CURRENCY.code,
  currencyDisplay: 'narrowSymbol',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const compactNumber = new Intl.NumberFormat(CURRENCY.locale, {
  notation: 'compact',
  maximumFractionDigits: 1,
});

function toNumber(value) {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
}

/** `₱1,234.50` by default, `₱1,235` when decimals are off. */
export function formatMoney(value, { decimals = true } = {}) {
  const amount = toNumber(value);
  return (decimals ? moneyFull : moneyWhole).format(amount);
}

/** `+₱1,234.50` for income, `−₱1,234.50` for expenses. */
export function formatSignedMoney(value, type) {
  const sign = type === 'income' ? '+' : '−';
  return `${sign}${formatMoney(Math.abs(toNumber(value)))}`;
}

export function formatCompact(value) {
  return compactNumber.format(toNumber(value));
}

export function round2(value) {
  return Math.round((toNumber(value) + Number.EPSILON) * 100) / 100;
}

/**
 * Reads what a person typed into an amount field.
 * Returns a positive number rounded to centavos, or null when unusable.
 */
export function parseAmount(raw) {
  if (raw === null || raw === undefined) return null;
  const text = String(raw)
    .trim()
    .replace(/[\s,]/g, '')
    .replace(/[₱$€£¥₹]/g, '');

  if (!text || !/\d/.test(text)) return null;
  if (!/^\d{0,9}(\.\d{0,2})?$/.test(text)) return null;

  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0 || value > MAX_AMOUNT) return null;

  return round2(value);
}

export function formatPercent(value, total) {
  const part = toNumber(value);
  const whole = toNumber(total);
  if (whole <= 0) return '0%';
  const percent = (part / whole) * 100;
  if (percent > 0 && percent < 1) return '<1%';
  return `${Math.round(percent)}%`;
}

export function pluralize(count, singular, plural = `${singular}s`) {
  return count === 1 ? singular : plural;
}

/* ------------------------------------------------------------------ */
/* dates                                                               */
/* ------------------------------------------------------------------ */

const pad = (value) => String(value).padStart(2, '0');

export function toISODate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Strict local parse of `YYYY-MM-DD`; returns null for impossible dates. */
export function parseISODate(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, month, day);
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) return null;
  return date;
}

export function isValidISODate(iso) {
  return parseISODate(iso) !== null;
}

export function todayISO(now = new Date()) {
  return toISODate(now);
}

export function monthKeyOf(date) {
  return toISODate(date).slice(0, 7);
}

export function currentMonthKey(now = new Date()) {
  return monthKeyOf(now);
}

export function monthOf(iso) {
  return String(iso).slice(0, 7);
}

export function monthStart(monthKey) {
  return `${monthKey}-01`;
}

export function daysInMonth(monthKey) {
  const [year, month] = String(monthKey).split('-').map(Number);
  if (!year || !month) return 30;
  return new Date(year, month, 0).getDate();
}

export function monthEnd(monthKey) {
  return `${monthKey}-${pad(daysInMonth(monthKey))}`;
}

export function shiftMonthKey(monthKey, delta) {
  const [year, month] = String(monthKey).split('-').map(Number);
  return monthKeyOf(new Date(year, month - 1 + delta, 1));
}

export function monthLabel(monthKey, { short = false } = {}) {
  const date = parseISODate(monthStart(monthKey));
  if (!date) return String(monthKey);
  return date.toLocaleDateString('en-PH', short
    ? { month: 'short', year: 'numeric' }
    : { month: 'long', year: 'numeric' });
}

/** `30 Oct` — compact enough for a table column. */
export function formatEntryDate(iso) {
  const date = parseISODate(iso);
  if (!date) return String(iso);
  return date.toLocaleDateString('en-PH', { day: '2-digit', month: 'short' });
}

/** `Friday, 30 October 2026` for the `<time title>`. */
export function formatFullDate(iso) {
  const date = parseISODate(iso);
  if (!date) return String(iso);
  return date.toLocaleDateString('en-PH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * How money was at risk of being spent by the end of the period: the months
 * that have already finished count in full, the current month counts up to today.
 */
export function elapsedDays(monthKey, now = new Date()) {
  const today = todayISO(now);
  if (monthKey < currentMonthKey(now)) return daysInMonth(monthKey);
  if (monthKey > currentMonthKey(now)) return 0;
  return Number(today.slice(8, 10));
}
