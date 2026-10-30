/**
 * Cloud store — the real app.
 *
 * The queries never filter by user id: RLS policies on `transactions` and
 * `budgets` match `auth.uid()` to `user_id`, so a tampered request cannot
 * widen its own access.
 */
import { deleteRows, insertRows, selectRows, updateRows, upsertRow } from '../supabase-rest.js';
import { monthEnd, monthStart, round2 } from '../format.js';

const COLUMNS = 'id,type,amount,category,occurred_on,note,created_at';

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
        'order=occurred_on.desc,created_at.desc',
      ].join('&');

      const budgetQuery = ['select=month,amount', `month=eq.${monthStart(monthKey)}`, 'limit=1'].join('&');

      const [rows, budgets] = await Promise.all([
        selectRows('transactions', transactionQuery),
        selectRows('budgets', budgetQuery),
      ]);

      return {
        transactions: (rows ?? []).map(normalize),
        budget: budgets?.length ? round2(budgets[0].amount) : null,
      };
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

    async setBudget(monthKey, amount) {
      await upsertRow('budgets', { month: monthStart(monthKey), amount: round2(amount) }, 'user_id,month');
    },

    async clearBudget(monthKey) {
      await deleteRows('budgets', `month=eq.${monthStart(monthKey)}`);
    },
  };
}
