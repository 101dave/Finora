-- Adds weekly budgets to an existing Finora database.
-- Safe to run once; the live project was migrated with exactly these statements.
-- Budgets become one row per (period, period_start):
--   period = 'month' → period_start is the 1st of the month
--   period = 'week'  → period_start is a Monday (ISO week, Monday–Sunday)

alter table public.budgets drop constraint if exists budgets_month_check;
alter table public.budgets drop constraint if exists budgets_pkey;

alter table public.budgets rename column month to period_start;

alter table public.budgets
  add column if not exists period text not null default 'month';

alter table public.budgets
  add constraint budgets_period_check check (period in ('month', 'week'));

alter table public.budgets
  add constraint budgets_period_start_check check (
    (period = 'month' and period_start = date_trunc('month', period_start)::date)
    or (period = 'week' and extract(isodow from period_start) = 1)
  );

alter table public.budgets
  add constraint budgets_pkey primary key (user_id, period, period_start);

-- Policies and the updated_at trigger are untouched: they only reference user_id.
