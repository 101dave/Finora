import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addDays,
  daysInMonth,
  formatDayRange,
  elapsedDays,
  formatEntryDate,
  formatMoney,
  formatPercent,
  formatSignedMoney,
  isValidISODate,
  monthEnd,
  monthLabel,
  monthOf,
  parseAmount,
  parseISODate,
  pluralize,
  round2,
  shiftMonthKey,
  todayISO,
  weekStartOf,
} from '../js/format.js';

const plain = (value) => String(value).replace(/\u00a0/g, ' ');

test('parseAmount reads what people actually type', () => {
  assert.equal(parseAmount('145.50'), 145.5);
  assert.equal(parseAmount(' 1,234 '), 1234);
  assert.equal(parseAmount('₱2,500.00'), 2500);
  assert.equal(parseAmount('.5'), 0.5);
});

test('parseAmount rejects anything that is not a positive centavo amount', () => {
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount('abc'), null);
  assert.equal(parseAmount('0'), null);
  assert.equal(parseAmount('-20'), null);
  assert.equal(parseAmount('12.345'), null);
  assert.equal(parseAmount('1000000000'), null);
});

test('money formatting is pesos with two decimals, or whole numbers when asked', () => {
  const full = plain(formatMoney(1234.5));
  const whole = plain(formatMoney(1234.5, { decimals: false }));

  assert.match(full, /1,234\.50/);
  assert.match(full, /₱/);
  assert.doesNotMatch(whole, /\./);
  assert.match(whole, /1,235/);
});

test('signed money uses a real minus sign for expenses', () => {
  assert.match(plain(formatSignedMoney(12.5, 'expense')), /^−/);
  assert.match(plain(formatSignedMoney(12.5, 'income')), /^\+/);
});

test('percentages stay readable at the edges', () => {
  assert.equal(formatPercent(25, 100), '25%');
  assert.equal(formatPercent(1, 0), '0%');
  assert.equal(formatPercent(0.5, 100), '<1%');
  assert.equal(formatPercent(150, 100), '150%');
});

test('ISO dates parse locally and impossible dates are refused', () => {
  const date = parseISODate('2026-10-30');
  assert.equal(date.getFullYear(), 2026);
  assert.equal(date.getMonth(), 9);
  assert.equal(date.getDate(), 30);

  assert.equal(parseISODate('2026-02-30'), null);
  assert.equal(parseISODate('30-10-2026'), null);
  assert.equal(isValidISODate('2024-02-29'), true);
});

test('month boundaries respect leap years and year changes', () => {
  assert.equal(daysInMonth('2024-02'), 29);
  assert.equal(daysInMonth('2026-02'), 28);
  assert.equal(monthEnd('2024-02'), '2024-02-29');
  assert.equal(shiftMonthKey('2026-01', -1), '2025-12');
  assert.equal(shiftMonthKey('2026-12', 1), '2027-01');
  assert.equal(monthOf('2026-10-30'), '2026-10');
});

test('labels and day counts describe the month a person is looking at', () => {
  assert.equal(monthLabel('2026-10'), 'October 2026');
  assert.match(monthLabel('2026-10', { short: true }), /Oct/);
  assert.equal(formatEntryDate('2026-10-05'), 'Oct 05');

  const now = new Date(2026, 9, 30);
  assert.equal(todayISO(now), '2026-10-30');
  assert.equal(elapsedDays('2026-09', now), 30);
  assert.equal(elapsedDays('2026-10', now), 30);
  assert.equal(elapsedDays('2026-11', now), 0);
});

test('small helpers keep their promises', () => {
  assert.equal(round2(0.1 + 0.2), 0.3);
  assert.equal(pluralize(1, 'entry', 'entries'), 'entry');
  assert.equal(pluralize(0, 'entry', 'entries'), 'entries');
});

test('weekStartOf lands on Monday, whichever day you start from', () => {
  // 2026-10-30 is a Friday; its ISO week starts Monday 26 October.
  assert.equal(weekStartOf('2026-10-30'), '2026-10-26');
  assert.equal(weekStartOf('2026-10-26'), '2026-10-26'); // Monday itself
  assert.equal(weekStartOf('2026-11-01'), '2026-10-26'); // Sunday belongs to that week
  assert.equal(weekStartOf('2026-11-02'), '2026-11-02'); // next Monday
});

test('addDays crosses month and year boundaries in local time', () => {
  assert.equal(addDays('2026-10-26', 6), '2026-11-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('formatDayRange names the month once, or twice across a boundary', () => {
  const within = formatDayRange('2026-10-05', '2026-10-11').replace(/\u00a0/g, ' ');
  assert.equal(within, '5 – 11 Oct');
  const across = formatDayRange('2026-10-26', '2026-11-01').replace(/\u00a0/g, ' ');
  assert.equal(across, '26 Oct – 1 Nov');
});
