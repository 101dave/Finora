/**
 * Cloud store — the real app.
 *
 * Budgets are keyed by (period, period_start): `month`/first of month, or
 * `week`/Monday. The app reads the month it is showing plus the week it is in.
 *
 * The queries never filter by user id: RLS policies on `transactions` and
 * `budgets` match `auth.uid()` to `user_id`, so a tampered request cannot
 * widen its own access.
 */
import { deleteRows, insertRows, selectRows, updateRows, upsertRow } from '../supabase-rest.js';
import { addDays, monthEnd, monthStart, round2 } from '../format.js';

const COLUMNS = 'id,type,amount,category,occurred_on,note,created_at';

/** Rows are ordered the way the list reads: newest first, then newest written. */
const ORDER = 'order=occurred_on.desc,created_at.desc';

function normalize(row) {
  return {
    id: row.id,
    type: row.type === 'income' ? 'income' : 'expense',
    amount: round2(row.amount),
    category: row.category,
    occurred_on: String(row.occurred_on).slice(0, 10),
    note: row.note ?? '',
    created_at: row.created_at ?? null,
  };
}

/** One budget row per period; absence means "no budget set". */
async function readBudget(period, periodStart) {
  const query = ['select=period_start,amount', `period=eq.${period}`, `period_start=eq.${periodStart}`, 'limit=1'].join('&');
  const rows = await selectRows('budgets', query);
  return rows?.length ? round2(rows[0].amount) : null;
}

function weekEnd(weekStartKey) {
  return addDays(weekStartKey, 6);
}

function toRow(entry) {
  return {
    type: entry.type,
    amount: round2(entry.amount),
    category: entry.category,
    occurred_on: entry.occurred_on,
    note: (entry.note ?? '').trim(),
  };
}

export function createSupabaseStore() {
  return {
    kind: 'cloud',

    async loadMonth(monthKey) {
      const transactionQuery = [
        `select=${COLUMNS}`,
        `occurred_on=gte.${monthStart(monthKey)}`,
        `occurred_on=lte.${monthEnd(monthKey)}`,
        ORDER,
      ].join('&');

      const [rows, budget] = await Promise.all([
        selectRows('transactions', transactionQuery),
        readBudget('month', monthStart(monthKey)),
      ]);

      return { transactions: (rows ?? []).map(normalize), budget };
    },

    /**
     * The week a weekly budget applies to. It is fetched separately because a
     * Monday–Sunday week usually straddles two months.
     */
    async loadWeek(weekStartKey) {
      const transactionQuery = [
        `select=${COLUMNS}`,
        `occurred_on=gte.${weekStartKey}`,
        `occurred_on=lte.${weekEnd(weekStartKey)}`,
        ORDER,
      ].join('&');

      const [rows, budget] = await Promise.all([
        selectRows('transactions', transactionQuery),
        readBudget('week', weekStartKey),
      ]);

      return { transactions: (rows ?? []).map(normalize), budget };
    },

    async createTransaction(entry) {
      const rows = await insertRows('transactions', [toRow(entry)]);
      return normalize(rows[0]);
    },

    async updateTransaction(id, entry) {
      const rows = await updateRows('transactions', `id=eq.${encodeURIComponent(id)}`, toRow(entry));
      if (!rows?.length) throw new Error('That entry is no longer available.');
      return normalize(rows[0]);
    },

    async deleteTransaction(id) {
      await deleteRows('transactions', `id=eq.${encodeURIComponent(id)}`);
    },

    async setBudget(period, periodStart, amount) {
      await upsertRow(
        'budgets',
        { period, period_start: periodStart, amount: round2(amount) },
        'user_id,period,period_start',
      );
    },

    async clearBudget(period, periodStart) {
      await deleteRows('budgets', `period=eq.${period}&period_start=eq.${periodStart}`);
    },
  };
}
