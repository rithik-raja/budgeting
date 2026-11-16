# Budgeting

Personal budgeting app. Read-only SimpleFIN sync, local SQLite, no manual entry.

## Setup

1. Get a SimpleFIN setup token from https://beta-bridge.simplefin.org/simplefin/create
2. Put it in `.env` (server-only, **no** `NEXT_PUBLIC_` prefix):

   ```
   SIMPLEFIN_TOKEN=<base64 setup token>
   OPENCODE_API_KEY=<OpenCode key>
   ```

   The setup token is one-time-use. On first sync it is exchanged for an Access
   URL, which is saved to `data/simplefin/access-url.txt` (mode 600) and reused
   from then on.

   `OPENCODE_API_KEY` is used during sync to categorize new transactions with
   `deepseek-v4.1-flash`. If it is missing or the request fails, new rows fall
   back to `Other` and the sync still succeeds. By default the script calls
   OpenCode Go (`https://opencode.ai/zen/go/v1/chat/completions`); set
   `OPENCODE_CHAT_URL` to override the endpoint.

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

Every transaction has a category. Seeds: **Groceries**, **Bills**, **Dining**,
**Shopping**, **Gas**, **Other**, **Transfer**, and **Income**. `Other` is the
fallback and cannot be deleted.

New transactions are assigned automatically during sync: the script sends the
current category names and the new transaction descriptions to
`deepseek-v4.1-flash` through the OpenCode API. If the API key is missing or a
request fails, the transaction lands in `Other`.

To change one transaction, click its category in the month view and pick another
category from the dropdown. Existing transactions are never re-categorized by a
later sync.

## SimpleFIN notes

- Requests are `GET /accounts?version=2` with a 90-day window and 5-day overlap
  to catch late posts.
- Pending transactions are requested (`pending=1`).
- Non-USD accounts are skipped.
- All errors from `errlist` are logged; 403/402 are surfaced with remediation.
