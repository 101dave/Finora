/**
 * Offline-capable store wrapper around the cloud store.
 *
 * Keeps a per-user local snapshot of transactions and budgets plus an ordered
 * outbox of pending writes in localStorage. Reads fall back to the local
 * snapshot whenever the network is unreachable; writes apply immediately to the
 * local snapshot, queue in the outbox when offline, and replay in order as soon
 * as connectivity returns.
 */
import { addDays, monthEnd, monthStart, round2 } from '../format.js';
import { isOfflineError } from '../supabase-rest.js';

const CACHE_PREFIX = 'finora.cache.v1.';
const OUTBOX_PREFIX = 'finora.outbox.v1.';

function isLocalId(id) {
  return String(id).startsWith('local-');
}

function makeId(prefix) {
  const rand = Math.random().toString(36).slice(2, 9);
  return `${prefix}-${Date.now().toString(36)}-${rand}`;
}

function budgetKeyOf(period, periodStart) {
  return `${period}:${periodStart}`;
}

function weekEnd(weekStartKey) {
  return addDays(weekStartKey, 6);
}

function normalizeTx(row) {
  return {
    id: String(row.id),
    type: row.type === 'income' ? 'income' : 'expense',
    amount: round2(row.amount),
    category: row.category,
    occurred_on: String(row.occurred_on).slice(0, 10),
    note: (row.note ?? '').trim(),
    created_at: row.created_at ?? null,
  };
}

function toPayload(entry) {
  return {
    type: entry.type === 'income' ? 'income' : 'expense',
    amount: round2(entry.amount),
    category: entry.category,
    occurred_on: String(entry.occurred_on).slice(0, 10),
    note: (entry.note ?? '').trim(),
  };
}

function sortTransactions(rows) {
  return [...rows].sort((a, b) => {
    if (a.occurred_on !== b.occurred_on) return a.occurred_on < b.occurred_on ? 1 : -1;
    return String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''));
  });
}

function emptyCache() {
  return {
    version: 1,
    transactionsById: {},
    budgets: {},
  };
}

function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function requestBackgroundSync() {
  try {
    const sw = globalThis.navigator?.serviceWorker;
    if (!sw?.ready) return;
    sw.ready.then((reg) => reg?.sync?.register?.('finora-sync')).catch(() => {});
  } catch {
    /* Background Sync API is optional */
  }
}

export function createOfflineStore({
  remote,
  userId = 'default',
  storage = defaultStorage(),
  isOnline = () => globalThis.navigator?.onLine !== false,
  onStatusChange,
} = {}) {
  const scope = encodeURIComponent(String(userId || 'default'));
  const cacheStorageKey = `${CACHE_PREFIX}${scope}`;
  const outboxStorageKey = `${OUTBOX_PREFIX}${scope}`;

  let memoryCache = readCacheFromStorage();
  let memoryOutbox = readOutboxFromStorage();
  let remoteReachable = isOnline();
  let syncing = false;
  let syncPromise = null;
  const listeners = new Set();
  if (typeof onStatusChange === 'function') listeners.add(onStatusChange);

  function readCacheFromStorage() {
    if (!storage) return emptyCache();
    try {
      const raw = storage.getItem(cacheStorageKey);
      if (!raw) return emptyCache();
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return emptyCache();
      return {
        version: 1,
        transactionsById: parsed.transactionsById && typeof parsed.transactionsById === 'object'
          ? parsed.transactionsById
          : {},
        budgets: parsed.budgets && typeof parsed.budgets === 'object'
          ? parsed.budgets
          : {},
      };
    } catch {
      return emptyCache();
    }
  }

  function readOutboxFromStorage() {
    if (!storage) return [];
    try {
      const raw = storage.getItem(outboxStorageKey);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function persistCache() {
    if (!storage) return;
    try {
      storage.setItem(cacheStorageKey, JSON.stringify(memoryCache));
    } catch {
      /* quota or private-mode restriction: memoryCache still serves the tab */
    }
  }

  function persistOutbox() {
    if (!storage) return;
    try {
      if (memoryOutbox.length) {
        storage.setItem(outboxStorageKey, JSON.stringify(memoryOutbox));
      } else {
        storage.removeItem(outboxStorageKey);
      }
    } catch {
      /* memoryOutbox still serves the tab */
    }
  }

  function getStatus() {
    const navigatorOnline = isOnline();
    return {
      online: navigatorOnline && remoteReachable,
      syncing,
      pendingCount: memoryOutbox.length,
    };
  }

  function emitStatus() {
    const snapshot = getStatus();
    for (const listener of listeners) {
      try {
        listener(snapshot);
      } catch {
        /* UI callback errors must never break store operations */
      }
    }
  }

  function pendingState() {
    const touchedTxIds = new Set();
    const deletedTxIds = new Set();
    const touchedBudgetKeys = new Set();

    for (const op of memoryOutbox) {
      if (op.kind === 'create_tx' || op.kind === 'update_tx') touchedTxIds.add(op.id);
      else if (op.kind === 'delete_tx') {
        touchedTxIds.add(op.id);
        deletedTxIds.add(op.id);
      } else if (op.kind === 'set_budget' || op.kind === 'clear_budget') {
        touchedBudgetKeys.add(budgetKeyOf(op.period, op.periodStart));
      }
    }

    return { touchedTxIds, deletedTxIds, touchedBudgetKeys };
  }

  function mergeRangeIntoCache(startISO, endISO, serverRows, period, periodStart, serverBudget) {
    const { touchedTxIds, deletedTxIds, touchedBudgetKeys } = pendingState();
    const incomingIds = new Set((serverRows ?? []).map((row) => String(row.id)));

    for (const [id, existing] of Object.entries(memoryCache.transactionsById)) {
      if (isLocalId(id) || touchedTxIds.has(id)) continue;
      if (existing.occurred_on >= startISO && existing.occurred_on <= endISO && !incomingIds.has(id)) {
        delete memoryCache.transactionsById[id];
      }
    }

    for (const row of serverRows ?? []) {
      const normalized = normalizeTx(row);
      if (deletedTxIds.has(normalized.id)) continue;
      if (touchedTxIds.has(normalized.id)) continue;
      memoryCache.transactionsById[normalized.id] = normalized;
    }

    const bKey = budgetKeyOf(period, periodStart);
    if (!touchedBudgetKeys.has(bKey)) {
      memoryCache.budgets[bKey] = typeof serverBudget === 'number' ? round2(serverBudget) : null;
    }

    persistCache();
  }

  function readRangeFromCache(startISO, endISO, period, periodStart) {
    const transactions = sortTransactions(
      Object.values(memoryCache.transactionsById).filter(
        (entry) => entry.occurred_on >= startISO && entry.occurred_on <= endISO,
      ),
    );
    const bKey = budgetKeyOf(period, periodStart);
    const budget = typeof memoryCache.budgets[bKey] === 'number' ? memoryCache.budgets[bKey] : null;
    return { transactions, budget };
  }

  function queueOp(op) {
    memoryOutbox.push(op);
    persistOutbox();
    requestBackgroundSync();
    emitStatus();
  }

  async function sync() {
    if (!isOnline()) {
      remoteReachable = false;
      emitStatus();
      return { synced: 0, remaining: memoryOutbox.length };
    }

    if (!memoryOutbox.length) {
      remoteReachable = true;
      emitStatus();
      return { synced: 0, remaining: 0 };
    }

    if (syncPromise) return syncPromise;

    syncing = true;
    emitStatus();

    syncPromise = (async () => {
      let synced = 0;

      while (memoryOutbox.length > 0) {
        if (!isOnline()) {
          remoteReachable = false;
          break;
        }

        const op = memoryOutbox[0];

        try {
          if (op.kind === 'create_tx') {
            const created = normalizeTx(await remote.createTransaction(op.payload));
            delete memoryCache.transactionsById[op.id];
            memoryCache.transactionsById[created.id] = created;

            // Rewrite any later queued ops that referenced the temporary local ID.
            for (let i = 1; i < memoryOutbox.length; i += 1) {
              if (memoryOutbox[i].id === op.id) {
                memoryOutbox[i] = { ...memoryOutbox[i], id: created.id };
              }
            }
            persistCache();
          } else if (op.kind === 'update_tx') {
            try {
              const updated = normalizeTx(await remote.updateTransaction(op.id, op.payload));
              memoryCache.transactionsById[updated.id] = updated;
              persistCache();
            } catch (err) {
              if (isOfflineError(err)) throw err;
              if (err?.status === 401) throw err;
              // Row was deleted elsewhere; drop stale local copy so queue can progress.
              delete memoryCache.transactionsById[op.id];
              persistCache();
            }
          } else if (op.kind === 'delete_tx') {
            await remote.deleteTransaction(op.id);
            delete memoryCache.transactionsById[op.id];
            persistCache();
          } else if (op.kind === 'set_budget') {
            await remote.setBudget(op.period, op.periodStart, op.amount);
            memoryCache.budgets[budgetKeyOf(op.period, op.periodStart)] = round2(op.amount);
            persistCache();
          } else if (op.kind === 'clear_budget') {
            await remote.clearBudget(op.period, op.periodStart);
            memoryCache.budgets[budgetKeyOf(op.period, op.periodStart)] = null;
            persistCache();
          }

          memoryOutbox.shift();
          persistOutbox();
          remoteReachable = true;
          synced += 1;
        } catch (error) {
          if (isOfflineError(error)) {
            remoteReachable = false;
            break;
          }
          throw error;
        }
      }

      return { synced, remaining: memoryOutbox.length };
    })().finally(() => {
      syncing = false;
      syncPromise = null;
      emitStatus();
    });

    return syncPromise;
  }

  async function loadRange(startISO, endISO, period, periodStart, loader) {
    if (!isOnline()) {
      remoteReachable = false;
      emitStatus();
      return readRangeFromCache(startISO, endISO, period, periodStart);
    }

    if (memoryOutbox.length > 0) {
      try {
        await sync();
      } catch {
        /* auth or validation errors surface on the remote read below if applicable */
      }
    }

    try {
      const result = await loader();
      remoteReachable = true;
      mergeRangeIntoCache(startISO, endISO, result.transactions, period, periodStart, result.budget);
      emitStatus();
      return readRangeFromCache(startISO, endISO, period, periodStart);
    } catch (error) {
      if (isOfflineError(error)) {
        remoteReachable = false;
        emitStatus();
        return readRangeFromCache(startISO, endISO, period, periodStart);
      }
      throw error;
    }
  }

  return {
    kind: 'offline-cloud',

    subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      listener(getStatus());
      return () => listeners.delete(listener);
    },

    getStatus,

    pendingCount() {
      return memoryOutbox.length;
    },

    markConnectivity(online) {
      remoteReachable = Boolean(online);
      emitStatus();
    },

    sync,

    clearLocal() {
      memoryCache = emptyCache();
      memoryOutbox = [];
      if (storage) {
        try {
          storage.removeItem(cacheStorageKey);
          storage.removeItem(outboxStorageKey);
        } catch {
          /* ignore storage errors */
        }
      }
      emitStatus();
    },

    loadMonth(monthKey) {
      const start = monthStart(monthKey);
      const end = monthEnd(monthKey);
      return loadRange(start, end, 'month', start, () => remote.loadMonth(monthKey));
    },

    loadWeek(weekStartKey) {
      const start = weekStartKey;
      const end = weekEnd(weekStartKey);
      return loadRange(start, end, 'week', start, () => remote.loadWeek(weekStartKey));
    },

    async createTransaction(entry) {
      const payload = toPayload(entry);

      if (isOnline() && memoryOutbox.length === 0) {
        try {
          const created = normalizeTx(await remote.createTransaction(payload));
          remoteReachable = true;
          memoryCache.transactionsById[created.id] = created;
          persistCache();
          emitStatus();
          return created;
        } catch (error) {
          if (!isOfflineError(error)) throw error;
          remoteReachable = false;
        }
      } else if (!isOnline()) {
        remoteReachable = false;
      }

      const localRow = normalizeTx({
        id: makeId('local'),
        ...payload,
        created_at: new Date().toISOString(),
      });
      memoryCache.transactionsById[localRow.id] = localRow;
      persistCache();
      queueOp({
        opId: makeId('op'),
        kind: 'create_tx',
        id: localRow.id,
        payload,
      });
      return localRow;
    },

    async updateTransaction(id, entry) {
      const targetId = String(id);
      const payload = toPayload(entry);

      if (isOnline() && memoryOutbox.length === 0 && !isLocalId(targetId)) {
        try {
          const updated = normalizeTx(await remote.updateTransaction(targetId, payload));
          remoteReachable = true;
          memoryCache.transactionsById[updated.id] = updated;
          persistCache();
          emitStatus();
          return updated;
        } catch (error) {
          if (!isOfflineError(error)) throw error;
          remoteReachable = false;
        }
      } else if (!isOnline()) {
        remoteReachable = false;
      }

      const previous = memoryCache.transactionsById[targetId];
      const updatedLocal = normalizeTx({
        id: targetId,
        ...payload,
        created_at: previous?.created_at ?? new Date().toISOString(),
      });
      memoryCache.transactionsById[targetId] = updatedLocal;
      persistCache();

      const createIndex = memoryOutbox.findIndex((op) => op.kind === 'create_tx' && op.id === targetId);
      if (createIndex !== -1) {
        memoryOutbox[createIndex] = { ...memoryOutbox[createIndex], payload };
        persistOutbox();
        emitStatus();
        return updatedLocal;
      }

      const updateIndex = memoryOutbox.findIndex((op) => op.kind === 'update_tx' && op.id === targetId);
      if (updateIndex !== -1) {
        memoryOutbox[updateIndex] = { ...memoryOutbox[updateIndex], payload };
        persistOutbox();
        emitStatus();
        return updatedLocal;
      }

      queueOp({
        opId: makeId('op'),
        kind: 'update_tx',
        id: targetId,
        payload,
      });
      return updatedLocal;
    },

    async deleteTransaction(id) {
      const targetId = String(id);

      if (isOnline() && memoryOutbox.length === 0 && !isLocalId(targetId)) {
        try {
          await remote.deleteTransaction(targetId);
          remoteReachable = true;
          delete memoryCache.transactionsById[targetId];
          persistCache();
          emitStatus();
          return;
        } catch (error) {
          if (!isOfflineError(error)) throw error;
          remoteReachable = false;
        }
      } else if (!isOnline()) {
        remoteReachable = false;
      }

      delete memoryCache.transactionsById[targetId];
      persistCache();

      const hadCreate = memoryOutbox.some((op) => op.kind === 'create_tx' && op.id === targetId);
      memoryOutbox = memoryOutbox.filter((op) => op.id !== targetId);

      if (hadCreate || isLocalId(targetId)) {
        persistOutbox();
        emitStatus();
        return;
      }

      queueOp({
        opId: makeId('op'),
        kind: 'delete_tx',
        id: targetId,
      });
    },

    async setBudget(period, periodStart, amount) {
      const cleanAmount = round2(amount);
      const bKey = budgetKeyOf(period, periodStart);
      const hasPendingBudget = memoryOutbox.some(
        (op) => (op.kind === 'set_budget' || op.kind === 'clear_budget')
          && op.period === period
          && op.periodStart === periodStart,
      );

      if (isOnline() && !hasPendingBudget && memoryOutbox.length === 0) {
        try {
          await remote.setBudget(period, periodStart, cleanAmount);
          remoteReachable = true;
          memoryCache.budgets[bKey] = cleanAmount;
          persistCache();
          emitStatus();
          return;
        } catch (error) {
          if (!isOfflineError(error)) throw error;
          remoteReachable = false;
        }
      } else if (!isOnline()) {
        remoteReachable = false;
      }

      memoryCache.budgets[bKey] = cleanAmount;
      persistCache();

      memoryOutbox = memoryOutbox.filter(
        (op) => !((op.kind === 'set_budget' || op.kind === 'clear_budget')
          && op.period === period
          && op.periodStart === periodStart),
      );
      queueOp({
        opId: makeId('op'),
        kind: 'set_budget',
        period,
        periodStart,
        amount: cleanAmount,
      });
    },

    async clearBudget(period, periodStart) {
      const bKey = budgetKeyOf(period, periodStart);
      const hasPendingBudget = memoryOutbox.some(
        (op) => (op.kind === 'set_budget' || op.kind === 'clear_budget')
          && op.period === period
          && op.periodStart === periodStart,
      );

      if (isOnline() && !hasPendingBudget && memoryOutbox.length === 0) {
        try {
          await remote.clearBudget(period, periodStart);
          remoteReachable = true;
          memoryCache.budgets[bKey] = null;
          persistCache();
          emitStatus();
          return;
        } catch (error) {
          if (!isOfflineError(error)) throw error;
          remoteReachable = false;
        }
      } else if (!isOnline()) {
        remoteReachable = false;
      }

      memoryCache.budgets[bKey] = null;
      persistCache();

      memoryOutbox = memoryOutbox.filter(
        (op) => !((op.kind === 'set_budget' || op.kind === 'clear_budget')
          && op.period === period
          && op.periodStart === periodStart),
      );
      queueOp({
        opId: makeId('op'),
        kind: 'clear_budget',
        period,
        periodStart,
      });
    },
  };
}
