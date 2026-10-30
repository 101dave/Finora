/**
 * Sample data for the demo.
 *
 * Three months: the current one clipped to today, the previous one with a
 * budget, and the one before that without a budget. Nothing here touches the
 * network — the demo store keeps it in localStorage.
 */
import { monthKeyOf, round2, shiftMonthKey } from './format.js';

function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `demo-${Math.random().toString(16).slice(2)}-${Date.now().toString(36)}`;
}

function entry(monthKey, day, type, category, amount, note) {
  return {
    id: newId(),
    type,
    category,
    amount: round2(amount),
    occurred_on: `${monthKey}-${String(day).padStart(2, '0')}`,
    note,
    created_at: new Date().toISOString(),
  };
}

/** [daysBeforeToday, category, amount, note] */
const CURRENT_SPEND = [
  [0, 'Food', 145, 'Lunch at the canteen'],
  [1, 'Transport', 48, 'Jeepney fare'],
  [1, 'Groceries', 640, 'Groceries for the week'],
  [2, 'Food', 90, 'Milk tea after class'],
  [3, 'Education', 120, 'Printing the manuscript'],
  [4, 'Bills', 300, 'Mobile load'],
  [5, 'Food', 60, 'Breakfast on the way'],
  [6, 'Fun', 250, 'Movie with friends'],
  [8, 'Health', 180, 'Vitamins'],
  [9, 'Shopping', 420, 'Notebook and pens'],
  [11, 'Rent', 2500, 'Share for rent'],
  [14, 'Groceries', 380, 'Milk, rice, eggs'],
  [17, 'Food', 210, 'Dinner with blockmates'],
];

/** [dayOfMonth, category, amount, note] */
const PREVIOUS_SPEND = [
  [2, 'Rent', 2500, 'Share for rent'],
  [2, 'Groceries', 720, 'Groceries for the week'],
  [4, 'Food', 180, 'Lunch after class'],
  [6, 'Transport', 60, 'Jeepney fare'],
  [8, 'Bills', 500, 'Electric bill share'],
  [10, 'Education', 350, 'Reference book'],
  [11, 'Food', 240, 'Dinner with blockmates'],
  [13, 'Shopping', 680, 'New slippers'],
  [15, 'Bills', 899, 'Internet share'],
  [17, 'Food', 120, 'Milk tea'],
  [19, 'Health', 260, 'Clinic visit'],
  [22, 'Fun', 400, 'Weekend out'],
  [24, 'Transport', 120, 'Ride home'],
  [26, 'Groceries', 540, 'Milk, rice, eggs'],
  [28, 'Food', 95, 'Snacks'],
];

const EARLIER_SPEND = [
  [3, 'Food', 160, 'Lunch at the canteen'],
  [5, 'Transport', 80, 'Fare to school'],
  [7, 'Groceries', 500, 'Groceries'],
  [9, 'Bills', 450, 'Mobile load'],
  [12, 'Education', 300, 'Lab manual'],
  [14, 'Food', 220, 'Dinner out'],
  [18, 'Fun', 350, 'Basketball game'],
  [21, 'Shopping', 600, 'School shirt'],
  [25, 'Health', 150, 'First aid'],
];

export function seedDemoData(now = new Date()) {
  const current = monthKeyOf(now);
  const previous = shiftMonthKey(current, -1);
  const earlier = shiftMonthKey(current, -2);
  const today = now.getDate();

  const transactions = [];

  // Current month: nothing in the future, so offsets are clamped to day 1..today.
  for (const [back, category, amount, note] of CURRENT_SPEND) {
    const day = Math.max(1, Math.min(today, today - back));
    transactions.push(entry(current, day, 'expense', category, amount, note));
  }

  transactions.push(entry(current, 1, 'income', 'Allowance', 6000, 'Allowance from home'));
  const freelanceDay = Math.max(1, Math.floor(today * 0.6));
  transactions.push(entry(current, freelanceDay, 'income', 'Freelance', 1800, 'Layout for a student org'));

  for (const [day, category, amount, note] of PREVIOUS_SPEND) {
    transactions.push(entry(previous, day, 'expense', category, amount, note));
  }
  transactions.push(entry(previous, 1, 'income', 'Allowance', 6000, 'Allowance from home'));
  transactions.push(entry(previous, 14, 'income', 'Allowance', 4500, 'Second allowance'));
  transactions.push(entry(previous, 22, 'income', 'Freelance', 2000, 'Poster for a org event'));

  for (const [day, category, amount, note] of EARLIER_SPEND) {
    transactions.push(entry(earlier, day, 'expense', category, amount, note));
  }
  transactions.push(entry(earlier, 1, 'income', 'Allowance', 6000, 'Allowance from home'));
  transactions.push(entry(earlier, 15, 'income', 'Allowance', 4000, 'Second allowance'));

  transactions.sort((a, b) => (a.occurred_on < b.occurred_on ? 1 : -1));

  return {
    version: 1,
    transactions,
    budgets: {
      [current]: 10000,
      [previous]: 12000,
    },
    seededAt: new Date().toISOString(),
  };
}
