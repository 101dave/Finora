# Finora

A quiet personal expense tracker. Log what comes in and what goes out, set a
monthly and a weekly budget, and see the whole month honestly.

No framework, no build step, no package to install: plain HTML, CSS and ES
modules, with Supabase for real accounts and real storage.

- **Live:** <https://101dave.github.io/Finora/>
- **Portfolio:** <https://ebaleallandave.vercel.app/PROJECT-EXPENSE.html>

---

## What it does

- **Accounts** — email and password sign-up / sign-in via Supabase Auth, with a
  confirmation email before the first sign-in.
- **Password reset** — “Forgot password?” on the sign-in card emails a link;
  opening it lands on a “choose a new password” card that saves through
  `PUT /auth/v1/user` and drops you straight into your ledger. The request shows
  the same message whether or not the address has an account, so it cannot be
  used to discover who is registered.
- **Entries** — income or expense, amount, category, date and an optional note.
  Edit and delete any entry.
- **One month at a time** — move backwards and forwards through months; the
  current month is clipped to today.
- **Two budgets** — one per month and one per week (Monday to Sunday, ISO
  weeks). Each has its own meter: grey near the limit, black hatching past it.
  The monthly meter follows the month you are browsing; the weekly one always
  reads the week you are in, and says which dates that is.
- **Filters** — by type, category and free-text search across notes.
- **A category breakdown** — a Chart.js doughnut plus a text legend that carries
  every value, so the canvas is never the only source of information.
- **Small insights** — largest expense, average per day, days logged.
- **Installable PWA** — a relative-path web manifest, monochrome icons, a
  static app-shell service worker (Supabase Auth and PostgREST always go
  straight to the network), and a “Download App” banner under the sign-in card
  that triggers `beforeinstallprompt` where supported or shows clear
  browser-menu instructions elsewhere.

Keyboard: press **n** anywhere outside a field to add an entry. `Esc` closes any
dialog.

---

## Run it locally

Any static server works; ES modules will not load from `file://`.

```bash
python3 -m http.server 3000 --bind 0.0.0.0
# open http://localhost:3000 → sign in with a real account
```

or `npm run dev` (the same command).

Sample-data mode (`?demo=1`) was removed on request, so the app is real accounts
only — a visitor needs an account to see the dashboard.

```bash
npm test        # 12 dependency-free unit tests (money, dates, week maths)
```

---

## Structure

```
index.html            markup for both screens and every dialog
styles.css            black and white, light only, responsive table → cards
manifest.json         PWA manifest (relative ./ paths for Pages + Vercel)
sw.js                 static app-shell service worker (never caches Supabase)
icon-*.png            monochrome 192 / 512 / maskable 512 + apple-touch-icon
js/
  app.js              picks a screen: auth or dashboard
  config.js           Supabase URL, publishable key, currency, limits
  auth.js             sign-in / create-account screen
  pwa.js              service-worker registration + Download App banner
  dashboard.js        one month of state: totals, filters, dialogs, chart
  format.js           money, percentages and date helpers (local dates only)
  categories.js       fixed category lists per entry type
  chart.js            doughnut wrapper around the vendored Chart.js
  supabase-rest.js    small fetch client for GoTrue + PostgREST
  dom.js              tiny DOM helpers (no innerHTML with user data)
  toast.js            one toast at a time, optional action
  store/
    supabase-store.js the only store: PostgREST behind RLS
vendor/chart.umd.js   Chart.js 4.6.1, vendored so runtime needs no CDN
supabase/schema.sql   reference DDL for the deployed database
tests/                node --test, no dependencies
```

`dashboard.js` reads and writes through one small store object — `loadMonth`,
`loadWeek`, `createTransaction`, `updateTransaction`, `deleteTransaction`,
`setBudget(period, periodStart, amount)`, `clearBudget(period, periodStart)` —
and never builds a query itself. All filtering, totals and
formatting happen in the browser on rows the database already agreed to return.

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

`budgets` — primary key `(user_id, period, period_start)`, where `period` is
`month` or `week` and `period_start` is the 1st of the month or the Monday of an
ISO week. A check constraint enforces exactly that shape, and `amount` is
`numeric(12,2)` above zero (removing a budget deletes the row rather than
storing 0). Weekly budgets need their own query because a Monday–Sunday week
usually straddles two months.

If you are upgrading a database that predates weekly budgets, run
`supabase/migrate-weekly-budget.sql` once; it renames `month` to `period_start`,
adds `period`, and swaps the primary key.

Both tables have `updated_at` triggers, and an index on
`(user_id, occurred_on desc, created_at desc)` for the only listing query the
app makes.

### Row Level Security

Four policies per table (select / insert / update / delete), all
`to authenticated`, all comparing `(select auth.uid()) = user_id`. `anon` has no
privileges on either table. The frontend never filters by user id in its
queries — the policies do that — so a manipulated request cannot widen its own
access.

Supabase's default privileges hand `authenticated` **every** privilege on new
tables, `TRUNCATE` included, and `TRUNCATE` is not filtered by RLS. The project
therefore revokes `truncate, references, trigger, maintain` from `anon` and
`authenticated`, keeping only the four verbs the app uses. `verify-access.sql`
holds the inspection queries and the impersonation recipe used to prove this.

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

- [ ] `https://your-url/` shows the sign-in screen, not a blank page.
- [ ] Sign up with a real address, open the confirmation email, confirm, sign in.
- [ ] Add an entry, reload, confirm it is still there.
- [ ] Set a monthly budget and a weekly budget, reload, confirm both meters keep
      their values.
- [ ] Sign out, sign back in; entries are still yours.
- [ ] Tap **Forgot password?**, send the link, open it, set a new password, and
      land on the dashboard.
- [ ] A second account sees none of the first account's entries.

The two email round trips — confirming a new account and resetting a password —
are the steps that cannot be automated from here; they need a browser and a real
inbox.

---

## Accessibility

- Visible labels on every field; errors are linked with `aria-describedby` and
  announced through `role="alert"`.
- Native `<dialog>` elements handle focus trapping, Escape and focus return.
- The chart legend carries labels, values and percentages, so the canvas
  (`aria-hidden`) is decorative rather than the only source of information.
- Tables have real headers and a caption; on narrow screens rows become cards
  with the same reading order.
- Every row action is a 44 × 44 px target on a phone, and focus after a delete
  clears the sticky header instead of hiding under it.
- One light theme. No dark variant and no `prefers-color-scheme` rule, so a
  phone in dark mode still gets the same black-on-white page. Focus outlines are
  never removed.
- `prefers-reduced-motion` turns off transitions and chart animation.

---

## Design

One column, top to bottom: **month → three numbers → two budgets → entries →
one collapsed panel** with the chart and the small insights. The column is capped
at 760px so a laptop does not turn it into a spreadsheet, and nothing is more
than one tap away: the month arrows sit under the header, “Add entry” is in the
header at every width, and everything secondary lives behind the “Breakdown &
insights” disclosure (a native `<details>`, so it works with a keyboard and needs
no script).

Monochrome on purpose: black ink, white paper, one grey ramp. There is no accent
colour and no dark theme, so the page looks the same everywhere — including on a
phone set to dark mode. Meaning that used to ride on colour is carried by weight,
sign and shape instead:

- income is bold with a `+`, expense is regular with a `−`;
- the budget meter shades grey near the limit and turns to black hatching past it;
- errors are bold, with a 2px left rule;
- the doughnut uses a ten-step grey ramp, and the legend repeats every value.

Contrast: body text 19.4:1, secondary text 6.7:1, control borders 3.4:1, white on
black buttons 19.4:1.

The phone layout has tiers at 980 (tablet), 760 (large phone), 560 (phone),
400 (small phone), 360 (very small) and 320 px, plus a short-landscape tier for
`max-height: 520px`. Sizes are fluid in between — `clamp()` for money and padding,
`min-width: 0` on every grid child — so a 393 px Pixel and a 430 px iPhone Max
both land on sensible values, not just the exact breakpoints.

On a phone the same column simply narrows:

- the header keeps one row — the account collapses to its avatar and the “Add
  entry” label drops away below 360px;
- the three summary numbers stay side by side until 360px, where they stack into
  three short rows;
- entries become bordered cards with 44px actions;
- dialogs dock to the bottom as sheets, with a scrolling body and a sticky footer;
- 16px inputs stop iOS from zooming when a field is focused;
- `env(safe-area-inset-*)` keeps the header, footer and toast clear of the notch
  and home indicator; the viewport sets `viewport-fit=cover` to make room.

---

## Audit — October 2026

Everything below was checked against the code and the live project. The findings
that mattered were fixed in the same pass.

| Finding | Severity | Status |
| --- | --- | --- |
| The month arrows had no click handlers — you could never leave the current month | high | fixed |
| `authenticated` held `TRUNCATE` on both tables, which bypasses RLS | medium | revoked |
| A slow month request could overwrite the month you had just switched to | medium | fixed (request token) |
| `schema.sql` named the index differently from the deployed one, so re-running it would duplicate it | medium | fixed |
| `.badge` and avatar text were 4.35:1 on their background in the old warm palette | medium | fixed (palette since replaced) |
| Filter and auth toggles used `role="tablist"` with no tab panels | low | fixed (`aria-pressed` group) |
| On mobile, `display:none` on `<thead>` dropped the headers from the accessibility tree | low | fixed (visually hidden + explicit roles) |
| Deleting from the edit dialog closed it before you confirmed | low | fixed |
| `?error_description=` stayed in the address bar after a failed sign-in link | low | fixed |
| A very large amount could widen a summary card | low | fixed |
| The reference schema allowed a 0 budget while the UI refused it | low | fixed (both above zero) |

**Verified after the fixes**

- `npm test` — 12/12 unit tests, including Monday-of-the-week maths and the
  week-range label.
- jsdom integration — 41 checks in three processes: 28 for the dashboard (four
  blocks in order, one summary card, a collapsed details panel that rebuilds its
  legend and chart on open, both budget meters, the dialogs), 7 for the reset
  request, and 6 for the recovery link (tokens adopted and stripped, mismatched
  and short passwords refused, `PUT /auth/v1/user` with the recovery token).
- axe-core — 0 WCAG A/AA violations in four runs: sign-in, recover, the
  set-new-password card, and the simplified dashboard with the OS forced to dark.
- RLS — two impersonated users: A saw 1 row and none of B’s, cross-user updates
  and deletes affected 0 rows, a forged `user_id` insert failed with `42501`,
  and `anon` was denied. Test users and rows were deleted afterwards; the
  database is back to 0 rows.

**Still open (deliberately, or needs you)**

- **No Content-Security-Policy.** The inline theme script is gone, so
  `script-src 'self'` is now possible without any refactor; add
  `connect-src 'self' https://*.supabase.co` alongside it. Skipped here because
  it cannot be verified without a real browser.
- **Default Supabase SMTP** is rate limited (2 emails/hour) and intended for
  testing. Configure custom SMTP before inviting anyone, or confirmation emails
  will silently fail.
- **Password policy is 6 characters with no breach check.** Raise it under
  Authentication → Policies; change `MIN_PASSWORD_LENGTH` in `js/config.js` to
  match what you choose.
- **No CSV export**, and the **confirmation / reset emails** still need a real
  inbox — they are the two things that cannot be automated here.
- **Reset emails are rate limited** by Supabase (2 per hour by default, shared
  with confirmation mail). The form says so instead of failing silently; custom
  SMTP lifts the ceiling.

## What I'd add next

CSV export, recurring entries, and user-defined categories stored per account. Each is a real improvement, but none is needed
to make the core loop feel finished — and keeping that loop small is why the app
is easy to read.
