/**
 * Demo store — same interface as the Supabase store, no network.
 *
 * Everything lives in localStorage. Writes are applied to a copy first and
 * only replace the in-memory state once they have actually been persisted, so
 * a blocked or full storage area leaves both the data and the UI untouched.
 */
import { DEMO_STORAGE_KEY } from '../config.js';
import { seedDemoData } from '../demo-data.js';
import { monthOf, round2 } from '../format.js';

const clone = (value) => JSON.parse(JSON.stringify(value));

function isEntryShape(entry) {
  return Boolean(
    entry
    && typeof entry.id === 'string'
    && (entry.type === 'income' || entry.type === 'expense')
    && Number.isFinite(Number(entry.amount))
    && typeof entry.occurred_on === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(entry.occurred_on)
    && typeof entry.note === 'string',
  );
}

function readState(storage) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(DEMO_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.transactions)) return null;
    if (!parsed.budgets || typeof parsed.budgets !== 'object') return null;
    return {
      transactions: parsed.transactions.filter(isEntryShape),
      budgets: parsed.budgets,
    };
  } catch (error) {
    return null;
  }
}

function fallbackStorage() {
  try {
    return window.localStorage;
  } catch (error) {
    return null;
  }
}

function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `demo-${Math.random().toString(16).slice(2)}-${Date.now().toString(36)}`;
}

function normalizeEntry(entry) {
  return {
    type: entry.type === 'income' ? 'income' : 'expense',
    amount: round2(entry.amount),
    category: String(entry.category),
    occurred_on: String(entry.occurred_on),
    note: (entry.note ?? '').trim(),
  };
}

const SAVE_FAILED = 'This browser could not save the change. Storage may be full or blocked.';

export function createLocalStore({ storage = fallbackStorage(), now = new Date() } = {}) {
  let state = readState(storage);

  if (!state) {
    state = seedDemoData(now);
    try {
      storage?.setItem(DEMO_STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      /* in-memory demo still works for this tab */
    }
  }

  /** Copy → mutate → persist → swap. On failure the current state survives. */
  function commit(mutate) {
    const draft = clone(state);
    mutate(draft);
    if (storage) {
      try {
        storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(draft));
      } catch (error) {
        throw new Error(SAVE_FAILED);
      }
    }
    state = draft;
    return draft;
  }

  return {
    kind: 'demo',

    async loadMonth(monthKey) {
      return {
        transactions: state.transactions
          .filter((entry) => monthOf(entry.occurred_on) === monthKey)
          .map(clone),
        budget: Object.prototype.hasOwnProperty.call(state.budgets, monthKey)
          ? round2(state.budgets[monthKey])
          : null,
      };
    },

    async createTransaction(entry) {
      const created = { id: newId(), ...normalizeEntry(entry), created_at: new Date().toISOString() };
      commit((draft) => {
        draft.transactions.push(created);
      });
      return clone(created);
    },

    async updateTransaction(id, entry) {
      let updated = null;
      commit((draft) => {
        const index = draft.transactions.findIndex((item) => item.id === id);
        if (index === -1) throw new Error('That entry is no longer here.');
        updated = { ...draft.transactions[index], ...normalizeEntry(entry) };
        draft.transactions[index] = updated;
      });
      return clone(updated);
    },

    async deleteTransaction(id) {
      commit((draft) => {
        draft.transactions = draft.transactions.filter((item) => item.id !== id);
      });
    },

    async setBudget(monthKey, amount) {
      commit((draft) => {
        draft.budgets[monthKey] = round2(amount);
      });
    },

    async clearBudget(monthKey) {
      commit((draft) => {
        delete draft.budgets[monthKey];
      });
    },

    /** "Reset sample data" in the account menu. */
    async resetDemo() {
      const fresh = seedDemoData(now);
      if (storage) {
        try {
          storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(fresh));
        } catch (error) {
          throw new Error(SAVE_FAILED);
        }
      }
      state = fresh;
    },
  };
}
