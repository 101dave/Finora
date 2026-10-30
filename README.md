# Finora

A quiet personal expense tracker. Log what comes in and what goes out, set one
monthly budget, and see the whole month honestly.

No framework, no build step, no package to install: plain HTML, CSS and ES
modules, with Supabase for real accounts and a local demo you can try instantly.

- **Demo:** `index.html?demo=1` (sample data, stored in your browser only)
- **Portfolio:** <https://ebaleallandave.vercel.app/PROJECT-EXPENSE.html>

---

## What it does

- **Accounts** — email and password sign-up / sign-in via Supabase Auth, with a
  confirmation email before the first sign-in.
- **Entries** — income or expense, amount, category, date and an optional note.
  Edit and delete any entry.
- **One month at a time** — move backwards and forwards through months; the
  current month is clipped to today.
- **A monthly budget** — one budget per month, with a meter that turns amber near
  the limit and red past it.
- **Filters** — by type, category and free-text search across notes.
- **A category breakdown** — a Chart.js doughnut plus a text legend that carries
  every value, so the canvas is never the only source of information.
- **Small insights** — largest expense, average per day, days logged.
- **Demo mode** — the same app, the same filters, dialogs and validation, running
  against seeded sample data in `localStorage`. It never calls Supabase.

Keyboard: press **n** anywhere outside a field to add an entry. `Esc` closes any
dialog.

---

## Run it locally

Any static server works; ES modules will not load from `file://`.

```bash
python3 -m http.server 3000 --bind 0.0.0.0
# open http://localhost:3000           → sign in with a real account
# open http://localhost:3000/?demo=1   → demo, no account needed
```

or `npm run dev` (the same command).

```bash
npm test        # 17 dependency-free unit tests (formatting + demo store)
```

---

## Structure

```
index.html            markup for both screens and every dialog
styles.css            one warm palette, light + dark, responsive table → cards
js/
  app.js              picks a screen: auth, dashboard or demo
  config.js           Supabase URL, publishable key, currency, limits
  auth.js             sign-in / create-account screen
  dashboard.js        one month of state: totals, filters, dialogs, chart
  format.js           money, percentages and date helpers (local dates only)
  categories.js       fixed category lists per entry type
  chart.js            doughnut wrapper around the vendored Chart.js
  supabase-rest.js    small fetch client for GoTrue + PostgREST
  dom.js              tiny DOM helpers (no innerHTML with user data)
  theme.js            system preference, remembered choice
  toast.js            one toast at a time, optional action
  store/
    supabase-store.js real accounts (RLS does the access control)
    local-store.js    demo, in localStorage, with rollback on failed writes
vendor/chart.umd.js   Chart.js 4.6.1, vendored so runtime needs no CDN
supabase/schema.sql   reference DDL for the deployed database
tests/                node --test, no dependencies
```

The seam that keeps this honest is the store interface. Both implementations
expose `loadMonth`, `createTransaction`, `updateTransaction`,
`deleteTransaction`, `setBudget` and `clearBudget`; `dashboard.js` never knows
which one it is talking to. The demo is therefore not a mock screen — it runs
the real UI.

---

## Supabase

Project: **Expense Tracker** (`mexckxbopmgmklusegwo`, `ap-southeast-1`).

Only the publishable key ships in `js/config.js`. It grants nothing by itself;
`anon` has no table privileges and every policy is owner-only.

### Tables

`transactions` — `id`, `user_id` (defaults to `auth.uid()`, FK to `auth.users`
with cascade), `type` (`income`/`expense`), `amount` `numeric(12,2)`, `category`,
`occurred_on` `date`, `note`, timestamps. Checks reject non-positive amounts,
bad types, notes over 200 characters and dates outside 2000–2100.

`budgets` — primary key `(user_id, month)`, one budget per month, `month` pinned
to the first of the month, `amount numeric(12,2)`.

Both tables have `updated_at` triggers, and an index on
`(user_id, occurred_on desc, created_at desc)` for the only listing query the
app makes.

### Row Level Security

Four policies per table (select / insert / update / delete), all
`to authenticated`, all comparing `(select auth.uid()) = user_id`. `anon` has no
privileges on either table. The frontend never filters by user id in its
queries — the policies do that — so a manipulated request cannot widen its own
access.

`schema.sql` is the deployed shape, written to be re-runnable (it will not drop
your data). Apply it with the Supabase SQL editor or `psql` if you ever rebuild
the project.

### Auth settings that matter

- `mailer_autoconfirm` is **off**: sign-ups must confirm their email before
  signing in.
- Site URL is `https://101dave.github.io/Finora/`.
- Redirect allow list currently includes that Pages URL, localhost:3000,
  localhost:8000 and `https://*.vercel.app/**`.
- **If you deploy somewhere else, add that URL to the redirect allow list** or
  confirmation links will fall back to the site URL.

Confirmation links come back with `#access_token=…&refresh_token=…`, which
`supabase-rest.js` picks up and stores before clearing the hash.

---

## Deployment

The whole folder is static. There is nothing to compile.

### Vercel

```bash
npm i -g vercel
vercel            # preview
vercel --prod     # production
```

Framework preset: **Other**. Build command: none. Output directory: `.`.
`vercel.json` adds `cleanUrls` and a couple of quiet security headers.

After the first deploy, copy the production URL into Supabase →
Authentication → URL Configuration → redirect allow list (the `*.vercel.app`
wildcard already covers preview URLs).

### GitHub Pages

`.github/workflows/pages.yml` publishes the repository root on every push to
`main`. Enable it once under **Settings → Pages → Source: GitHub Actions**.
That is the URL the portfolio case study links to.

### Checklist after deploying

- [ ] `https://your-url/` shows the sign-in screen (not a blank page, not the demo).
- [ ] `https://your-url/?demo=1` shows the seeded demo with a **Demo** pill.
- [ ] Sign up with a real address, open the confirmation email, confirm, sign in.
- [ ] Add an entry, reload, confirm it is still there.
- [ ] Set a budget, reload, confirm the meter keeps its value.
- [ ] Sign out, sign back in; entries are still yours.
- [ ] A second account sees none of the first account's entries.

The email round trip is the one step that cannot be automated from here; it has
to happen in a browser with a real inbox.

---

## The demo

`?demo=1` seeds three months relative to today:

1. the current month, with entries clipped so nothing sits in the future;
2. the previous month, with a budget set;
3. the month before that, without a budget.

Everything is editable. State survives a refresh because it lives in
`localStorage` under `finora.demo.v1`; **Reset sample data** in the account menu
restores the original seed. The demo never calls Supabase and never uploads
anything — that trade-off is stated in the UI footer.

---

## Accessibility

- Visible labels on every field; errors are linked with `aria-describedby` and
  announced through `role="alert"`.
- Native `<dialog>` elements handle focus trapping, Escape and focus return.
- The chart legend carries labels, values and percentages, so the canvas
  (`aria-hidden`) is decorative rather than the only source of information.
- Tables have real headers and a caption; on narrow screens rows become cards
  with the same reading order.
- Light and dark themes follow the system preference until you choose one, and
  the choice is remembered. Focus outlines are never removed.
- `prefers-reduced-motion` turns off transitions and chart animation.

---

## What I'd add next

CSV export, recurring entries, a password-reset screen, and user-defined
categories stored per account. Each is a real improvement, but none is needed
to make the core loop feel finished — and keeping that loop small is why the app
is easy to read.
