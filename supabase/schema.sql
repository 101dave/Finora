-- Finora — schema reference for the Supabase project
-- Project: Expense Tracker (mexckxbopmgmklusegwo)
--
-- This file documents what is deployed. It is written to be re-runnable:
-- running it against the live project is a no-op, not a reset.
--
-- Money is numeric(12,2). Dates are real `date` values. A user owns their rows
-- through `user_id`, defaulted to auth.uid(), and RLS — not the client — is
-- what restricts access.
--
-- Note for future tables: default privileges in `public` grant anon and
-- authenticated ALL. Any new table needs the same explicit revokes below, or it
-- will be readable by the whole internet before a policy is written.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- tables
-- ---------------------------------------------------------------------------
create table if not exists public.transactions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  type        text not null check (type in ('income', 'expense')),
  amount      numeric(12,2) not null check (amount > 0 and amount <= 999999999.99),
  category    text not null check (char_length(btrim(category)) between 1 and 40),
  occurred_on date not null check (occurred_on between '2000-01-01' and '2100-12-31'),
  note        text not null default '' check (char_length(note) <= 200),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.budgets (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  month      date not null check (month = date_trunc('month', month)::date),
  amount     numeric(12,2) not null check (amount > 0 and amount <= 999999999.99),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, month)
);

-- One index for the only listing query the app makes: this user, one month.
-- Name matches the deployed index; keeping it identical means re-running this
-- file cannot leave a duplicate index behind.
create index if not exists transactions_user_date_idx
  on public.transactions (user_id, occurred_on desc, created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
drop trigger if exists transactions_set_updated_at on public.transactions;
create trigger transactions_set_updated_at
  before update on public.transactions
  for each row execute function public.set_updated_at();

drop trigger if exists budgets_set_updated_at on public.budgets;
create trigger budgets_set_updated_at
  before update on public.budgets
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- row level security
-- ---------------------------------------------------------------------------
alter table public.transactions enable row level security;
alter table public.budgets enable row level security;

-- anon has no table privileges at all: the demo never touches the database,
-- and an unauthenticated request cannot even reach a policy.
revoke all on public.transactions from anon;
revoke all on public.budgets from anon;

-- Supabase's default privileges hand anon and authenticated ALL on every new
-- table in public. TRUNCATE is the dangerous one: it is not filtered by RLS, so
-- a signed-in user with that grant could empty every account's rows. The app
-- only ever needs SELECT / INSERT / UPDATE / DELETE, so take the rest back.
revoke truncate, references, trigger, maintain
  on public.transactions, public.budgets
  from anon, authenticated;

grant select, insert, update, delete on public.transactions to authenticated;
grant select, insert, update, delete on public.budgets to authenticated;

drop policy if exists transactions_select_own on public.transactions;
create policy transactions_select_own on public.transactions
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists transactions_insert_own on public.transactions;
create policy transactions_insert_own on public.transactions
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists transactions_update_own on public.transactions;
create policy transactions_update_own on public.transactions
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists transactions_delete_own on public.transactions;
create policy transactions_delete_own on public.transactions
  for delete to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists budgets_select_own on public.budgets;
create policy budgets_select_own on public.budgets
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists budgets_insert_own on public.budgets;
create policy budgets_insert_own on public.budgets
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists budgets_update_own on public.budgets;
create policy budgets_update_own on public.budgets
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists budgets_delete_own on public.budgets;
create policy budgets_delete_own on public.budgets
  for delete to authenticated
  using ((select auth.uid()) = user_id);
