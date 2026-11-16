import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { getDb, SYSTEM_CATEGORIES } from "../lib/db.ts";
import { merchantKey } from "../lib/merchant.ts";
import { fetchAccounts, type SimpleFinAccountSet } from "../lib/simplefin.ts";

/**
 * Standalone script: Node does not read .env the way Next.js does, so load it
 * ourselves. Uses process.loadEnvFile (Node 20.12+) and ignores a missing file.
 */
function loadEnv() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;
  try {
    process.loadEnvFile(envPath);
  } catch {
    // Malformed .env — the token check below produces a clearer error.
  }
}

loadEnv();

/** SimpleFIN expects <= 24 requests/day. Refuse well before the hard limit. */
const DAILY_REQUEST_LIMIT = 20;
/** Per docs: overlap the window ~5 days to avoid missing late posts. */
const OVERLAP_DAYS = 5;
/** Max window per request per docs. */
const MAX_WINDOW_DAYS = 90;

const DAY = 86400;

/** Computed per call — a long-running loop must not use a stale timestamp. */
const nowSec = () => Math.floor(Date.now() / 1000);

function hash(...parts: (string | number)[]): string {
  return createHash("sha256").update(parts.join(":")).digest("hex");
}

function txId(accountId: string, externalId: string, posted: number, amount: number, description: string) {
  return hash(accountId, externalId || `${posted}|${amount}|${description}`);
}

/** Epoch for midnight UTC of the day containing `ts`. */
function dayStart(ts: number): number {
  return Math.floor(ts / DAY) * DAY;
}

function checkQuota(db: ReturnType<typeof getDb>) {
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM sync_log WHERE started_at > ?`)
    .get(nowSec() - DAY) as { n: number } | undefined;
  const used = row?.n ?? 0;
  if (used >= DAILY_REQUEST_LIMIT) {
    throw new Error(
      `Refusing to sync: ${used} requests in the last 24h (self-imposed cap ${DAILY_REQUEST_LIMIT}). ` +
        `SimpleFIN allows ~24/day. Reusing cached data at data/simplefin/latest.json instead.`
    );
  }
  console.log(`Quota: ${used}/${DAILY_REQUEST_LIMIT} requests used in the last 24h.`);
}

function resolveWindow(db: ReturnType<typeof getDb>) {
  const row = db.prepare(`SELECT MAX(posted_at) AS latest FROM transactions`).get() as
    | { latest: number | null }
    | undefined;

  const endDate = dayStart(nowSec()) + DAY; // exclusive upper bound = tomorrow
  let startDate: number;
  if (row?.latest) {
    startDate = dayStart(row.latest) - OVERLAP_DAYS * DAY;
  } else {
    startDate = endDate - MAX_WINDOW_DAYS * DAY;
  }
  const span = (endDate - startDate) / DAY;
  if (span > MAX_WINDOW_DAYS) startDate = endDate - MAX_WINDOW_DAYS * DAY;
  return { startDate, endDate };
}

/**
 * Transfers are movements between the user's own accounts (card payments,
 * savings transfers). Merchant autopay (utilities, subscriptions) is a normal
 * expense, NOT a transfer.
 */
function isTransferDescription(description: string): boolean {
  const d = description.toLowerCase();
  return (
    /(online transfer|ach payment|payment thank you|card payment|credit card payment|transfer to|transfer from|internal transfer|mobile banking payment|payment from chk|bill ?pay)/.test(
      d
    ) || /^\s*transfer\b/.test(d)
  );
}

/** First-run categorization. Everything unmatched lands in `Other` by design. */
function defaultCategoryFor(
  description: string,
  amount: number,
  ids: { transferId: number; incomeId: number; fallbackId: number }
): number {
  if (isTransferDescription(description)) return ids.transferId;
  if (amount > 0) return ids.incomeId;
  return ids.fallbackId;
}

function categoryMap(db: ReturnType<typeof getDb>): Map<string, number> {
  const rows = db.prepare(`SELECT id, name FROM categories`).all() as {
    id: number;
    name: string;
  }[];
  return new Map(rows.map((r) => [r.name, r.id]));
}

function ruleMap(db: ReturnType<typeof getDb>): Map<string, number> {
  const rows = db.prepare(`SELECT merchant_key, category_id FROM category_rules`).all() as {
    merchant_key: string;
    category_id: number;
  }[];
  return new Map(rows.map((r) => [r.merchant_key, r.category_id]));
}

export function upsertAccountSet(
  accountSet: SimpleFinAccountSet,
  rawPath: string,
  window: { startDate: number; endDate: number },
  existingSyncId?: number
) {
  const db = getDb();
  const ts = nowSec();
  const cats = categoryMap(db);
  const rules = ruleMap(db);

  const fallbackId = cats.get(SYSTEM_CATEGORIES.fallback);
  const transferId = cats.get(SYSTEM_CATEGORIES.transfer);
  const incomeId = cats.get(SYSTEM_CATEGORIES.income);
  if (!fallbackId || !transferId || !incomeId) {
    throw new Error("System categories missing; database not seeded correctly.");
  }

  const syncId =
    existingSyncId ??
    Number(
      db
        .prepare(
          `INSERT INTO sync_log (started_at, status, start_date, end_date, raw_path)
           VALUES (?, 'running', ?, ?, ?)`
        )
        .run(ts, window.startDate, window.endDate, rawPath).lastInsertRowid
    );

  db.prepare(`UPDATE sync_log SET raw_path = ? WHERE id = ?`).run(rawPath, syncId);

  const upsertAccount = db.prepare(
    `INSERT INTO accounts (id, conn_id, name, currency, balance, available_balance, balance_date, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       conn_id = excluded.conn_id,
       name = excluded.name,
       currency = excluded.currency,
       balance = excluded.balance,
       available_balance = excluded.available_balance,
       balance_date = excluded.balance_date,
       updated_at = excluded.updated_at`
  );

  // Category is only set on insert; existing rows keep whatever the user chose.
  const insertTx = db.prepare(
    `INSERT INTO transactions
       (id, account_id, external_id, posted_at, transacted_at, amount, description,
        raw_description, pending, category_id, merchant_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`
  );

  const updateTx = db.prepare(
    `UPDATE transactions
        SET pending = ?, description = ?, amount = ?, transacted_at = ?, updated_at = ?
      WHERE id = ?`
  );

  let inserted = 0;
  let updated = 0;
  let accountCount = 0;

  db.exec("BEGIN");
  try {
    for (const acct of accountSet.accounts ?? []) {
      if (acct.currency && acct.currency !== "USD") {
        console.warn(`  Skipping non-USD account "${acct.name}" (${acct.currency}).`);
        continue;
      }

      upsertAccount.run(
        acct.id,
        acct.conn_id,
        acct.name,
        acct.currency ?? "USD",
        acct.balance != null ? Number(acct.balance) : null,
        acct["available-balance"] != null ? Number(acct["available-balance"]) : null,
        acct["balance-date"] ?? null,
        ts,
        ts
      );
      accountCount++;

      for (const tx of acct.transactions ?? []) {
        const posted = tx.posted || ts;
        const amount = Number(tx.amount);
        if (!Number.isFinite(amount)) {
          console.warn(`  Skipping malformed amount for "${tx.description}"`);
          continue;
        }
        const description = tx.description.replace(/\s+/g, " ").trim();
        const key = merchantKey(description);
        const id = txId(acct.id, tx.id, posted, amount, description);

        // Explicit user rule wins; otherwise transfer/income heuristics; else Other.
        const categoryId = rules.get(key) ?? defaultCategoryFor(description, amount, {
          transferId,
          incomeId,
          fallbackId,
        });

        const existing = db
          .prepare(`SELECT id FROM transactions WHERE id = ?`)
          .get(id) as { id: string } | undefined;

        if (existing) {
          updateTx.run(tx.pending ? 1 : 0, description, amount, tx.transacted_at ?? null, ts, id);
          updated++;
        } else {
          insertTx.run(
            id,
            acct.id,
            tx.id ?? null,
            posted,
            tx.transacted_at ?? null,
            amount,
            description,
            tx.description,
            tx.pending ? 1 : 0,
            categoryId,
            key,
            ts,
            ts
          );
          inserted++;
        }
      }
    }

    db.prepare(
      `UPDATE sync_log SET finished_at = ?, status = 'ok', accounts = ?, inserted = ?, updated = ? WHERE id = ?`
    ).run(Math.floor(Date.now() / 1000), accountCount, inserted, updated, syncId);

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    db.prepare(`UPDATE sync_log SET finished_at = ?, status = 'error', error = ? WHERE id = ?`).run(
      Math.floor(Date.now() / 1000),
      String(err),
      syncId
    );
    throw err;
  }

  return { inserted, updated, accounts: accountCount };
}

async function runOnce(): Promise<void> {
  const db = getDb();
  checkQuota(db);

  const window = resolveWindow(db);
  console.log(
    `Fetching ${new Date(window.startDate * 1000).toISOString().slice(0, 10)} → ${new Date(
      window.endDate * 1000
    )
      .toISOString()
      .slice(0, 10)} (pending included)`
  );

  // Record the attempt up front so a failed fetch still leaves a trace in the
  // database (and counts against the quota). upsertAccountSet adopts this row.
  const attempt = db
    .prepare(
      `INSERT INTO sync_log (started_at, status, start_date, end_date)
       VALUES (?, 'running', ?, ?)`
    )
    .run(nowSec(), window.startDate, window.endDate);
  const attemptId = Number(attempt.lastInsertRowid);

  let fetched: { accountSet: SimpleFinAccountSet; rawPath: string };
  try {
    fetched = await fetchAccounts({
      startDate: window.startDate,
      endDate: window.endDate,
      pending: true,
    });
  } catch (err) {
    db.prepare(
      `UPDATE sync_log SET finished_at = ?, status = 'error', error = ? WHERE id = ?`
    ).run(nowSec(), err instanceof Error ? err.message : String(err), attemptId);
    throw err;
  }

  const result = upsertAccountSet(fetched.accountSet, fetched.rawPath, window, attemptId);
  console.log(
    `Synced ${result.accounts} account(s): ${result.inserted} inserted, ${result.updated} updated.`
  );
}

/** Accepts "6h", "90m", "30s", or a bare number of seconds. */
function parseInterval(input: string): number {
  const m = input.trim().match(/^(\d+(?:\.\d+)?)\s*(s|m|h|d)?$/i);
  if (!m) {
    throw new Error(
      `Invalid interval "${input}". Use seconds or a suffix, e.g. 21600, 360m, 6h, 1d.`
    );
  }
  const value = Number(m[1]);
  const unit = (m[2] ?? "s").toLowerCase();
  const mult = unit === "s" ? 1 : unit === "m" ? 60 : unit === "h" ? 3600 : 86400;
  const seconds = Math.round(value * mult);
  if (seconds < 60) {
    throw new Error("Interval must be at least 60 seconds (SimpleFIN allows ~24 requests/day).");
  }
  return seconds;
}

function formatDuration(seconds: number): string {
  if (seconds % 86400 === 0) return `${seconds / 86400}d`;
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

function stamp(): string {
  return new Date().toLocaleString("en-US", { hour12: false });
}

const USAGE = `
Usage: node scripts/sync.ts [interval] [--once]

  interval   How often to sync. Accepts "6h", "90m", "21600", "1d". Default: 6h
  --once     Sync a single time and exit.

Runs a sync immediately, then repeats forever at the given interval.
No cron needed. SimpleFIN permits ~24 requests/day; the script self-limits
only to that budget, so intervals under ~1h will mostly no-op on quota.
`.trim();

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log(USAGE);
    return;
  }

  const once = args.includes("--once");
  const intervalArg = args.find((a) => !a.startsWith("-")) ?? "6h";
  const interval = parseInterval(intervalArg);

  if (once) {
    console.log(`[${stamp()}] Single sync requested.`);
    await runOnce();
    return;
  }

  console.log(`[${stamp()}] Starting sync loop every ${formatDuration(interval)}. Ctrl-C to stop.`);

  let stopping = false;
  let timer: NodeJS.Timeout | undefined;

  const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`\n[${stamp()}] ${signal} received — shutting down after current sync.`);
    if (timer) clearTimeout(timer);
    // Force exit if a network call hangs.
    setTimeout(() => process.exit(0), 5000).unref();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  while (!stopping) {
    try {
      await runOnce();
    } catch (err) {
      // A failed sync must not kill the loop — log and retry next interval.
      console.error(`[${stamp()}] Sync failed: ${err instanceof Error ? err.message : err}`);
    }

    if (stopping) break;

    const next = Date.now() + interval * 1000;
    console.log(`[${stamp()}] Next sync at ${new Date(next).toLocaleString("en-US")}.`);

    await new Promise<void>((resolve) => {
      timer = setTimeout(resolve, interval * 1000);
    });
  }

  console.log(`[${stamp()}] Stopped.`);
}

main().catch((err) => {
  console.error(`\nSync script failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});