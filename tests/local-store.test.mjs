import test from 'node:test';
import assert from 'node:assert/strict';

import { createLocalStore } from '../js/store/local-store.js';
import { DEMO_STORAGE_KEY } from '../js/config.js';
import { currentMonthKey, monthOf, shiftMonthKey, todayISO } from '../js/format.js';

class MemoryStorage {
  constructor() {
    this.map = new Map();
    this.failWrites = false;
  }

  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }

  setItem(key, value) {
    if (this.failWrites) throw new Error('QuotaExceededError');
    this.map.set(key, String(value));
  }

  removeItem(key) {
    this.map.delete(key);
  }
}

const NOW = new Date(2026, 9, 30, 12, 0, 0);
const CURRENT = currentMonthKey(NOW);
const PREVIOUS = shiftMonthKey(CURRENT, -1);
const EARLIER = shiftMonthKey(CURRENT, -2);

test('the demo seeds three months, clipped to today', async () => {
  const store = createLocalStore({ storage: new MemoryStorage(), now: NOW });
  const current = await store.loadMonth(CURRENT);
  const previous = await store.loadMonth(PREVIOUS);
  const earlier = await store.loadMonth(EARLIER);

  assert.ok(current.transactions.length > 0);
  assert.ok(previous.transactions.length > 0);
  assert.ok(earlier.transactions.length > 0);

  const future = current.transactions.filter((entry) => entry.occurred_on > todayISO(NOW));
  assert.deepEqual(future, [], 'the current month never contains a future entry');

  assert.equal(previous.budget, 12000);
  assert.equal(earlier.budget, null);
});

test('loadMonth only returns entries from the month asked for', async () => {
  const store = createLocalStore({ storage: new MemoryStorage(), now: NOW });
  const { transactions } = await store.loadMonth(PREVIOUS);

  assert.ok(transactions.every((entry) => monthOf(entry.occurred_on) === PREVIOUS));
});

test('entries can be created, edited and deleted, and the change survives a remount', async () => {
  const storage = new MemoryStorage();
  const store = createLocalStore({ storage, now: NOW });

  const created = await store.createTransaction({
    type: 'expense',
    amount: 99.5,
    category: 'Food',
    occurred_on: `${CURRENT}-05`,
    note: 'Test merienda',
  });

  let loaded = await store.loadMonth(CURRENT);
  assert.ok(loaded.transactions.some((entry) => entry.id === created.id));

  await store.updateTransaction(created.id, {
    type: 'expense',
    amount: 120,
    category: 'Fun',
    occurred_on: `${CURRENT}-05`,
    note: 'Renamed',
  });

  const remounted = createLocalStore({ storage, now: NOW });
  loaded = await remounted.loadMonth(CURRENT);
  const updated = loaded.transactions.find((entry) => entry.id === created.id);

  assert.equal(updated.amount, 120);
  assert.equal(updated.category, 'Fun');
  assert.equal(updated.note, 'Renamed');

  await remounted.deleteTransaction(created.id);
  loaded = await remounted.loadMonth(CURRENT);
  assert.equal(loaded.transactions.some((entry) => entry.id === created.id), false);
});

test('budgets are per month and can be replaced or removed', async () => {
  const store = createLocalStore({ storage: new MemoryStorage(), now: NOW });

  await store.setBudget(EARLIER, 5000);
  assert.equal((await store.loadMonth(EARLIER)).budget, 5000);

  await store.setBudget(EARLIER, 6500.25);
  assert.equal((await store.loadMonth(EARLIER)).budget, 6500.25);

  await store.clearBudget(EARLIER);
  assert.equal((await store.loadMonth(EARLIER)).budget, null);
});

test('a failed write rolls back instead of leaving the UI out of sync', async () => {
  const storage = new MemoryStorage();
  const store = createLocalStore({ storage, now: NOW });

  const before = await store.loadMonth(CURRENT);
  storage.failWrites = true;

  await assert.rejects(
    () => store.createTransaction({
      type: 'expense',
      amount: 500,
      category: 'Other',
      occurred_on: `${CURRENT}-02`,
      note: 'Never saved',
    }),
    /could not save/i,
  );

  storage.failWrites = false;
  const after = await store.loadMonth(CURRENT);

  assert.equal(after.transactions.length, before.transactions.length);
  assert.equal(after.transactions.some((entry) => entry.note === 'Never saved'), false);
});

test('editing an entry that no longer exists is refused', async () => {
  const store = createLocalStore({ storage: new MemoryStorage(), now: NOW });

  await assert.rejects(
    () => store.updateTransaction('missing-id', {
      type: 'expense',
      amount: 10,
      category: 'Food',
      occurred_on: `${CURRENT}-05`,
      note: '',
    }),
    /no longer here/i,
  );
});

test('corrupt stored data falls back to a fresh seed', async () => {
  const storage = new MemoryStorage();
  storage.setItem(DEMO_STORAGE_KEY, '{ not json');

  const store = createLocalStore({ storage, now: NOW });
  const { transactions } = await store.loadMonth(CURRENT);

  assert.ok(transactions.length > 0);
});

test('resetDemo restores the original sample months', async () => {
  const storage = new MemoryStorage();
  const store = createLocalStore({ storage, now: NOW });

  await store.createTransaction({
    type: 'expense',
    amount: 42,
    category: 'Other',
    occurred_on: `${CURRENT}-03`,
    note: 'Temporary',
  });
  await store.clearBudget(PREVIOUS);

  await store.resetDemo();

  const current = await store.loadMonth(CURRENT);
  const previous = await store.loadMonth(PREVIOUS);

  assert.equal(current.transactions.some((entry) => entry.note === 'Temporary'), false);
  assert.equal(previous.budget, 12000);
});
