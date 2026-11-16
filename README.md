# Budgeting

Personal budgeting app. Read-only SimpleFIN sync, local SQLite, no manual entry.

## Setup

1. Get a SimpleFIN setup token from https://beta-bridge.simplefin.org/simplefin/create
2. Put it in `.env` (server-only, **no** `NEXT_PUBLIC_` prefix):

   ```
   SIMPLEFIN_TOKEN=<base64 setup token>
   ```

   The setup token is one-time-use. On first sync it is exchanged for an Access
   URL, which is saved to `data/simplefin/access-url.txt` (mode 600) and reused
   from then on.

## Run

```bash
npm run sync        # sync now, then repeat every 6h forever (no cron needed)
npm run sync:once   # sync once and exit
npm run dev         # http://localhost:3000
```

`scripts/sync.ts` is standalone — it runs under plain `node` (no `tsx`) and
loads `.env` itself.

### Interval

```bash
node scripts/sync.ts 6h        # every 6 hours (default)
node scripts/sync.ts 90m
node scripts/sync.ts 21600     # plain seconds also work
node scripts/sync.ts 6h --once
node scripts/sync.ts --help
```

The script syncs immediately, then sleeps for the interval and repeats
indefinitely. A failing sync logs the error and keeps the loop alive; Ctrl-C
shuts down gracefully.

Minimum interval is 60s, but SimpleFIN permits **~24 requests/day**. The script
self-limits to 20 requests per rolling 24h and refuses to call the API past
that, so short intervals mostly no-op. 6h–12h is the sensible range.

## How data is stored

- `data/app.db` — SQLite via Node's builtin `node:sqlite` (WAL mode)
- `data/simplefin/raw/` — every `/accounts` response, cached verbatim **before**
  parsing, so a parse failure never costs a request
- `data/simplefin/latest.json` — most recent response

`/data/` is gitignored: it holds your financial data and Access URL.

## Categories

Every transaction has a category. Seeds: **Groceries**, **Bills**, **Other**,
plus system **Transfer** and **Income** (not user-assignable).

New transactions land in Other. Assign one from the month view — optionally
ticking "apply to similar transactions", which matches by normalized merchant
key (e.g. `TST* LEGEND BNG NAPLES FL` → `legend bng naples`) and applies across
all accounts. Learnings are stored in `category_rules`.

## SimpleFIN notes

- Requests are `GET /accounts?version=2` with a 90-day window and 5-day overlap
  to catch late posts.
- Pending transactions are requested (`pending=1`).
- Non-USD accounts are skipped.
- All errors from `errlist` are logged; 403/402 are surfaced with remediation.
