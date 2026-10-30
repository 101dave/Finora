import test from 'node:test';
import assert from 'node:assert/strict';

import { SESSION_KEY } from '../js/config.js';
import {
  ApiError,
  adoptSessionFromUrl,
  decodeJwtUser,
  getCurrentUser,
  isOfflineError,
  signOut,
} from '../js/supabase-rest.js';
import { createOfflineStore } from '../js/store/offline-store.js';

function createMemoryStorage() {
  const data = new Map();
  return {
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    },
    dump() {
      return Object.fromEntries(data.entries());
    },
  };
}

function makeFakeJwt(claims) {
  const encode = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(claims)}.signature`;
}

function createFakeRemoteStore({ initialTransactions = [], initialBudgets = {} } = {}) {
  let online = true;
  let seq = 1;
  const rows = new Map(initialTransactions.map((tx) => [tx.id, { ...tx }]));
  const budgets = new Map(Object.entries(initialBudgets));
  const calls = [];

  function ensureOnline() {
    if (!online) {
      throw new ApiError('Can’t reach the server. Check your connection and try again.', { status: 0 });
    }
  }

  return {
    calls,
    rows,
    budgets,
    setOnline(next) {
      online = next;
    },
    isOnline() {
      return online;
    },
    async loadMonth(monthKey) {
      ensureOnline();
      calls.push(['loadMonth', monthKey]);
      const start = `${monthKey}-01`;
      const end = `${monthKey}-31`;
      const transactions = [...rows.values()].filter(
        (tx) => tx.occurred_on >= start && tx.occurred_on <= end,
      );
      return {
        transactions,
        budget: budgets.get(`month:${start}`) ?? null,
      };
    },
    async loadWeek(weekStartKey) {
      ensureOnline();
      calls.push(['loadWeek', weekStartKey]);
      const startDate = new Date(`${weekStartKey}T00:00:00`);
      startDate.setDate(startDate.getDate() + 6);
      const y = startDate.getFullYear();
      const m = String(startDate.getMonth() + 1).padStart(2, '0');
      const d = String(startDate.getDate()).padStart(2, '0');
      const end = `${y}-${m}-${d}`;
      const transactions = [...rows.values()].filter(
        (tx) => tx.occurred_on >= weekStartKey && tx.occurred_on <= end,
      );
      return {
        transactions,
        budget: budgets.get(`week:${weekStartKey}`) ?? null,
      };
    },
    async createTransaction(entry) {
      ensureOnline();
      calls.push(['createTransaction', entry]);
      const created = {
        id: `srv-${seq++}`,
        ...entry,
        created_at: `2026-10-30T10:00:0${seq}Z`,
      };
      rows.set(created.id, created);
      return created;
    },
    async updateTransaction(id, entry) {
      ensureOnline();
      calls.push(['updateTransaction', id, entry]);
      if (!rows.has(id)) throw new Error('That entry is no longer available.');
      const updated = { ...rows.get(id), ...entry };
      rows.set(id, updated);
      return updated;
    },
    async deleteTransaction(id) {
      ensureOnline();
      calls.push(['deleteTransaction', id]);
      rows.delete(id);
    },
    async setBudget(period, periodStart, amount) {
      ensureOnline();
      calls.push(['setBudget', period, periodStart, amount]);
      budgets.set(`${period}:${periodStart}`, amount);
    },
    async clearBudget(period, periodStart) {
      ensureOnline();
      calls.push(['clearBudget', period, periodStart]);
      budgets.delete(`${period}:${periodStart}`);
    },
  };
}

test('decodeJwtUser reads user id and email from JWT payload for offline fallback', () => {
  const jwt = makeFakeJwt({ sub: 'user-123', email: 'dave@example.com' });
  assert.deepEqual(decodeJwtUser(jwt), {
    id: 'user-123',
    email: 'dave@example.com',
  });
  assert.equal(decodeJwtUser('not-a-jwt'), null);
});

test('getCurrentUser keeps signed-in user offline on network errors, and clears session on real 401', async (t) => {
  const origFetch = globalThis.fetch;
  const origLocation = globalThis.location;
  const origLocalStorage = globalThis.localStorage;
  const storage = createMemoryStorage();

  t.after(async () => {
    globalThis.fetch = origFetch;
    globalThis.location = origLocation;
    globalThis.localStorage = origLocalStorage;
    await signOut().catch(() => {});
  });

  const jwt = makeFakeJwt({ sub: 'user-offline-1', email: 'offline@finora.test' });
  globalThis.localStorage = storage;
  globalThis.location = {
    href: `https://finora.vercel.app/#access_token=${jwt}&refresh_token=ref-1&expires_in=1`,
    hash: `#access_token=${jwt}&refresh_token=ref-1&expires_in=1`,
    search: '',
    pathname: '/',
    origin: 'https://finora.vercel.app',
  };

  const adopted = adoptSessionFromUrl();
  assert.equal(adopted.user.id, 'user-offline-1');
  assert.equal(adopted.user.email, 'offline@finora.test');

  // Simulate being offline (fetch rejects with network TypeError -> ApiError status 0).
  globalThis.fetch = async () => {
    throw new TypeError('Failed to fetch');
  };

  const offlineUser = await getCurrentUser();
  assert.equal(offlineUser?.id, 'user-offline-1');
  assert.equal(offlineUser?.email, 'offline@finora.test');
  assert.ok(storage.getItem(SESSION_KEY), 'session remains persisted while offline');

  // Now simulate server explicitly rejecting with 401 on both /user and /token refresh.
  globalThis.fetch = async () => new Response(
    JSON.stringify({ error_description: 'Invalid Refresh Token' }),
    { status: 401 },
  );

  const rejectedUser = await getCurrentUser();
  assert.equal(rejectedUser, null);
  assert.equal(storage.getItem(SESSION_KEY), null, 'revoked session is cleared');
});

test('isOfflineError distinguishes network outages from server or validation errors', () => {
  assert.equal(isOfflineError(new ApiError('offline', { status: 0 })), true);
  assert.equal(isOfflineError(new TypeError('Failed to fetch')), true);
  assert.equal(isOfflineError(new ApiError('Unauthorized', { status: 401 })), false);
  assert.equal(isOfflineError(new ApiError('Forbidden', { status: 403 })), false);
});

test('offline store caches cloud reads and supports full CRUD + budgets while offline, then syncs in order', async () => {
  const storage = createMemoryStorage();
  const remote = createFakeRemoteStore({
    initialTransactions: [
      {
        id: 'srv-initial-1',
        type: 'expense',
        amount: 250,
        category: 'Food',
        occurred_on: '2026-10-28',
        note: 'dinner',
        created_at: '2026-10-28T12:00:00Z',
      },
      {
        id: 'srv-initial-2',
        type: 'expense',
        amount: 100,
        category: 'Transport',
        occurred_on: '2026-10-27',
        note: 'jeepney',
        created_at: '2026-10-27T08:00:00Z',
      },
    ],
    initialBudgets: {
      'month:2026-10-01': 12000,
      'week:2026-10-26': 3000,
    },
  });

  const store = createOfflineStore({
    remote,
    userId: 'user-a',
    storage,
    isOnline: () => remote.isOnline(),
  });

  // 1. Online initial load caches month and week.
  const onlineMonth = await store.loadMonth('2026-10');
  const onlineWeek = await store.loadWeek('2026-10-26');
  assert.equal(onlineMonth.transactions.length, 2);
  assert.equal(onlineMonth.budget, 12000);
  assert.equal(onlineWeek.budget, 3000);
  assert.equal(store.getStatus().online, true);
  assert.equal(store.pendingCount(), 0);

  // 2. Go offline!
  remote.setOnline(false);

  // Offline reads still return the cached entries and budgets.
  const cachedMonth = await store.loadMonth('2026-10');
  assert.equal(cachedMonth.transactions.length, 2);
  assert.equal(cachedMonth.budget, 12000);
  assert.equal(store.getStatus().online, false);

  // 3. Create an entry offline, then edit it offline -> coalesced into 1 create op!
  const createdOffline = await store.createTransaction({
    type: 'expense',
    amount: 145.5,
    category: 'Food',
    occurred_on: '2026-10-30',
    note: 'lunch',
  });
  assert.match(createdOffline.id, /^local-/);
  await store.updateTransaction(createdOffline.id, {
    type: 'expense',
    amount: 165,
    category: 'Food',
    occurred_on: '2026-10-30',
    note: 'lunch + drink',
  });

  // 4. Create a temporary entry offline and immediately delete it -> 0 remote calls!
  const ephemeral = await store.createTransaction({
    type: 'expense',
    amount: 50,
    category: 'Fun',
    occurred_on: '2026-10-30',
    note: 'mistake',
  });
  await store.deleteTransaction(ephemeral.id);

  // 5. Update one existing server entry and delete the other while offline.
  await store.updateTransaction('srv-initial-1', {
    type: 'expense',
    amount: 275,
    category: 'Food',
    occurred_on: '2026-10-28',
    note: 'dinner with tip',
  });
  await store.deleteTransaction('srv-initial-2');

  // 6. Update monthly budget and clear weekly budget while offline.
  await store.setBudget('month', '2026-10-01', 15000);
  await store.clearBudget('week', '2026-10-26');

  // 7. Simulate closing and reopening the PWA while STILL offline!
  const reloadedOfflineStore = createOfflineStore({
    remote,
    userId: 'user-a',
    storage,
    isOnline: () => remote.isOnline(),
  });
  assert.equal(reloadedOfflineStore.pendingCount(), 5);

  const monthWhileOffline = await reloadedOfflineStore.loadMonth('2026-10');
  const weekWhileOffline = await reloadedOfflineStore.loadWeek('2026-10-26');
  assert.equal(monthWhileOffline.budget, 15000);
  assert.equal(weekWhileOffline.budget, null);
  assert.deepEqual(
    monthWhileOffline.transactions.map((tx) => ({ note: tx.note, amount: tx.amount })),
    [
      { note: 'lunch + drink', amount: 165 },
      { note: 'dinner with tip', amount: 275 },
    ],
  );

  // 8. Reconnect and sync!
  remote.calls.length = 0;
  remote.setOnline(true);
  const syncResult = await reloadedOfflineStore.sync();
  assert.deepEqual(syncResult, { synced: 5, remaining: 0 });
  assert.equal(reloadedOfflineStore.pendingCount(), 0);
  assert.equal(reloadedOfflineStore.getStatus().online, true);

  // Ephemeral entry never hit the server; edited local entry was created once with final values.
  assert.deepEqual(
    remote.calls.map((c) => c[0]),
    ['createTransaction', 'updateTransaction', 'deleteTransaction', 'setBudget', 'clearBudget'],
  );
  assert.equal(remote.calls[0][1].amount, 165);
  assert.equal(remote.calls[0][1].note, 'lunch + drink');

  // Reloading from cloud now has real server IDs and exact state.
  const syncedMonth = await reloadedOfflineStore.loadMonth('2026-10');
  assert.equal(syncedMonth.transactions.length, 2);
  assert.ok(syncedMonth.transactions.every((tx) => tx.id.startsWith('srv-')));
  assert.equal(syncedMonth.budget, 15000);

  // 9. Signing out clears local cache and outbox for that user.
  reloadedOfflineStore.clearLocal();
  assert.deepEqual(storage.dump(), {});
});

test('partial sync does not duplicate already-synced items and isolates cache per userId', async () => {
  const storage = createMemoryStorage();
  const remote = createFakeRemoteStore();

  const storeA = createOfflineStore({
    remote,
    userId: 'user-a',
    storage,
    isOnline: () => remote.isOnline(),
  });
  const storeB = createOfflineStore({
    remote,
    userId: 'user-b',
    storage,
    isOnline: () => remote.isOnline(),
  });

  // Go offline and queue 2 entries for user-a.
  remote.setOnline(false);
  await storeA.createTransaction({
    type: 'expense',
    amount: 90,
    category: 'Food',
    occurred_on: '2026-10-30',
    note: 'first',
  });
  await storeA.createTransaction({
    type: 'expense',
    amount: 120,
    category: 'Transport',
    occurred_on: '2026-10-30',
    note: 'second',
  });

  // user-b on the same browser does not see user-a's cached offline entries.
  const bMonth = await storeB.loadMonth('2026-10');
  assert.equal(bMonth.transactions.length, 0);
  assert.equal(storeB.pendingCount(), 0);

  // Simulate connection dropping right after the 1st op succeeds!
  let createsAttempted = 0;
  const origCreate = remote.createTransaction.bind(remote);
  remote.createTransaction = async (entry) => {
    createsAttempted += 1;
    if (createsAttempted === 2) {
      remote.setOnline(false);
    }
    return origCreate(entry);
  };

  remote.setOnline(true);
  const firstPass = await storeA.sync();
  assert.deepEqual(firstPass, { synced: 1, remaining: 1 });
  assert.equal(remote.rows.size, 1, 'first item synced once');

  // Reconnect again: only the remaining 2nd item is sent, no duplicate of the 1st!
  remote.setOnline(true);
  const secondPass = await storeA.sync();
  assert.deepEqual(secondPass, { synced: 1, remaining: 0 });
  assert.equal(remote.rows.size, 2, 'exactly two rows in remote after resume');
});
