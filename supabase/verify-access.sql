-- Finora — access checks
--
-- Read-only inspection queries plus the impersonation recipe used during the
-- October 2026 audit. Run the queries in the Supabase SQL editor; they change
-- nothing. The impersonation block at the bottom is a recipe, not a script:
-- read it before running any of it.

-- ---------------------------------------------------------------------------
-- 1. who can touch the tables at all
-- ---------------------------------------------------------------------------
select table_name, grantee, string_agg(distinct privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('transactions', 'budgets')
group by 1, 2
order by 1, 2;

-- Expected: anon has no rows. authenticated has exactly
-- DELETE, INSERT, SELECT, UPDATE — no TRUNCATE, REFERENCES, TRIGGER or MAINTAIN.

-- ---------------------------------------------------------------------------
-- 2. is RLS on, and how many policies per table
-- ---------------------------------------------------------------------------
select c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       (select count(*) from pg_policy p where p.polrelid = c.oid) as policies
from pg_class c
where c.relnamespace = 'public'::regnamespace
  and c.relkind = 'r';

-- Expected: true and 4 for both tables.

-- ---------------------------------------------------------------------------
-- 3. the policies themselves
-- ---------------------------------------------------------------------------
select tablename, policyname, cmd, roles::text as roles, qual, with_check
from pg_policies
where schemaname = 'public'
order by tablename, cmd;

-- Expected: every policy is `to authenticated` and compares
-- `(select auth.uid()) = user_id`.

-- ---------------------------------------------------------------------------
-- 4. impersonation recipe (creates rows — clean up afterwards)
-- ---------------------------------------------------------------------------
-- auth.uid() reads the `sub` claim from the request, so a session can be
-- impersonated with two local settings inside a transaction:
--
--   begin;
--   set local role authenticated;
--   set local request.jwt.claim.sub = '<user uuid>';
--   set local request.jwt.claims = '{"sub":"<user uuid>","role":"authenticated","aud":"authenticated"}';
--   select count(*) from public.transactions;   -- only that user's rows
--   commit;
--
-- In the October 2026 audit this produced:
--   * 1 visible row for user A, 0 rows belonging to user B
--   * 0 rows affected by an update or delete aimed at user B
--   * `42501 new row violates row-level security policy` for an insert that
--     forged user_id = B
--   * `42501 permission denied for table transactions` after `set role anon`
--
-- Clean up afterwards:
--   delete from auth.users where email like 'finora-audit-%@example.invalid';
--   -- transactions and budgets cascade from auth.users
