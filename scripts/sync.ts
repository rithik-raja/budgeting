import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { FALLBACK_CATEGORY, getDb } from "../lib/db.ts";
import { merchantKey } from "../lib/merchant.ts";
import { isIgnoredAccount } from "../lib/flow.ts";
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

/** OpenCode Go exposes DeepSeek over an OpenAI-compatible Chat Completions API. */
const OPENCODE_API_KEY = process.env.OPENCODE_API_KEY?.trim();
const OPENCODE_CHAT_URL =
  process.env.OPENCODE_CHAT_URL ?? "https://opencode.ai/zen/go/v1/chat/completions";
const OPENCODE_MODEL = "deepseek-v4.1-flash";
const OPENCODE_SESSION = randomUUID();
const AI_BATCH_SIZE = 50;

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

function categoryOptions(db: ReturnType<typeof getDb>): { id: number; name: string }[] {
  return db
    .prepare(`SELECT id, name FROM categories ORDER BY sort_order, name`)
    .all() as { id: number; name: string }[];
}

interface NewTransaction {
  id: string;
  description: string;
  amount: number;
  accountName: string;
  pending: boolean;
}

/** New rows only: existing rows keep whatever category the user or a prior sync chose. */
function collectNewTransactions(
  db: ReturnType<typeof getDb>,
  accountSet: SimpleFinAccountSet,
  ts: number
): NewTransaction[] {
  const exists = db.prepare(`SELECT 1 AS found FROM transactions WHERE id = ?`);
  const seen = new Set<string>();
  const out: NewTransaction[] = [];

  for (const acct of accountSet.accounts ?? []) {
    if (acct.currency && acct.currency !== "USD") continue;
    if (isIgnoredAccount(acct.name)) continue;

    for (const tx of acct.transactions ?? []) {
      const amount = Number(tx.amount);
      if (!Number.isFinite(amount)) continue;

      const posted = tx.posted || tx.transacted_at || ts;
      const description = tx.description.replace(/\s+/g, " ").trim();
      const id = txId(acct.id, tx.id, posted, amount, description);
      if (seen.has(id) || exists.get(id)) continue;

      seen.add(id);
      out.push({
        id,
        description,
        amount,
        accountName: acct.name,
        pending: Boolean(tx.pending),
      });
    }
  }

  return out;
}

const CATEGORY_HINTS: Record<string, string> = {
  groceries: "supermarkets and grocery stores",
  bills: "mortgage/rent, utilities, phone/internet, insurance, subscriptions, fees, medical",
  dining: "restaurants, cafes, bars, takeout, food delivery",
  shopping: "retail, clothing, electronics, home goods, online marketplaces",
  gas: "fuel stations and gas/convenience purchases",
  other: "miscellaneous or genuinely unclear",
  transfer: "movements between the user's own accounts, card payments, savings sweeps",
  income: "payroll, interest, dividends, money received",
};

function systemPrompt(categories: string[]): string {
  const guide = categories
    .map((category) => `- ${category}: ${CATEGORY_HINTS[category.toLowerCase()] ?? "best fit"}`)
    .join("\n");

  return `You assign personal finance transactions to categories.
Choose exactly one category from the list for every transaction.
Use the exact category name. Never invent a category.
Amounts are signed: negative means money out, positive means money in.
Do not use Other for a recognizable merchant when a more specific category fits.
Categories:
${guide}
For a refund, use the category of the original purchase when obvious.
Use "${FALLBACK_CATEGORY}" when the category is unclear.
Return only JSON in this shape:
{"assignments":[{"id":"transaction id","category":"category name"}]}`;
}

function stripCodeFence(content: string): string {
  const match = content.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1] : content.trim();
}

function parseAssignments(value: unknown): { id: string; category: string }[] {
  if (!value || typeof value !== "object") return [];
  const raw = (value as { assignments?: unknown }).assignments;
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const { id, category } = item as { id?: unknown; category?: unknown };
    return typeof id === "string" && typeof category === "string" ? [{ id, category }] : [];
  });
}

async function categorizeBatch(
  categories: string[],
  batch: NewTransaction[]
): Promise<{ id: string; category: string }[]> {
  const res = await fetch(OPENCODE_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENCODE_API_KEY}`,
      "Content-Type": "application/json",
      "x-opencode-session": OPENCODE_SESSION,
    },
    body: JSON.stringify({
      model: OPENCODE_MODEL,
      messages: [
        { role: "system", content: systemPrompt(categories) },
        {
          role: "user",
          content: JSON.stringify({
            categories,
            transactions: batch.map((tx) => ({
              id: tx.id,
              description: tx.description.slice(0, 500),
              amount: tx.amount,
              account: tx.accountName,
              pending: tx.pending,
            })),
          }),
        },
      ],
      temperature: 0,
      max_tokens: 4096,
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(90_000),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenCode returned HTTP ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenCode returned an empty response.");

  return parseAssignments(JSON.parse(stripCodeFence(content)));
}

/**
 * Categorize new transactions in batches. Failures are non-fatal: those rows
 * fall back to `Other` so a sync never fails just because the model is down.
 */
async function categorizeNewTransactions(
  categories: { id: number; name: string }[],
  transactions: NewTransaction[]
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (transactions.length === 0) return result;
  if (categories.length <= 1) return result;

  if (!OPENCODE_API_KEY) {
    console.warn(`OPENCODE_API_KEY is not set; new transactions will use ${FALLBACK_CATEGORY}.`);
    return result;
  }

  const byName = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));
  const names = categories.map((c) => c.name);
  console.log(`Categorizing ${transactions.length} new transaction(s) with ${OPENCODE_MODEL}...`);

  for (let offset = 0; offset < transactions.length; offset += AI_BATCH_SIZE) {
    const batch = transactions.slice(offset, offset + AI_BATCH_SIZE);
    try {
      const assignments = await categorizeBatch(names, batch);
      let matched = 0;
      for (const assignment of assignments) {
        const categoryId = byName.get(assignment.category.trim().toLowerCase());
        if (!categoryId) continue;
        result.set(assignment.id, categoryId);
        matched++;
      }
      console.log(`  Batch ${offset / AI_BATCH_SIZE + 1}: ${matched}/${batch.length} assigned.`);
    } catch (err) {
      console.warn(
        `  Categorization batch failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return result;
}

export async function upsertAccountSet(
  accountSet: SimpleFinAccountSet,
  rawPath: string,
  window: { startDate: number; endDate: number },
  existingSyncId?: number
) {
  const db = getDb();
  const ts = nowSec();
  const categories = categoryOptions(db);

  const fallbackId = categories.find(
    (c) => c.name.toLowerCase() === FALLBACK_CATEGORY.toLowerCase()
  )?.id;
  if (!fallbackId) {
    throw new Error(`Fallback category "${FALLBACK_CATEGORY}" missing.`);
  }

  const newTransactions = collectNewTransactions(db, accountSet, ts);
  const aiCategories = await categorizeNewTransactions(categories, newTransactions);

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
  let ignoredCount = 0;

  db.exec("BEGIN");
  try {
    for (const acct of accountSet.accounts ?? []) {
      if (acct.currency && acct.currency !== "USD") {
        console.warn(`  Skipping non-USD account "${acct.name}" (${acct.currency}).`);
        continue;
      }

      // Deliberately ignored accounts still get their balance refreshed, but
      // their transactions never enter the database, so they cannot leak into
      // cash flow later.
      if (isIgnoredAccount(acct.name)) {
        ignoredCount++;
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
        // Pending transactions arrive with `posted: 0`. Stamping them with the
        // sync time files them into the wrong (current) month, so prefer the
        // transaction date the institution actually reported.
        const pending = Boolean(tx.pending);
        const posted = tx.posted || tx.transacted_at || ts;
        const amount = Number(tx.amount);
        if (!Number.isFinite(amount)) {
          console.warn(`  Skipping malformed amount for "${tx.description}"`);
          continue;
        }
        const description = tx.description.replace(/\s+/g, " ").trim();
        const key = merchantKey(description);
        const id = txId(acct.id, tx.id, posted, amount, description);

        // New rows use the AI result when available; existing rows keep their category.
        const categoryId = aiCategories.get(id) ?? fallbackId;

        const existing = db
          .prepare(`SELECT id FROM transactions WHERE id = ?`)
          .get(id) as { id: string } | undefined;

        if (existing) {
          updateTx.run(pending ? 1 : 0, description, amount, tx.transacted_at ?? null, ts, id);
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
            pending ? 1 : 0,
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

  return { inserted, updated, accounts: accountCount, categorized: aiCategories.size };
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

  const result = await upsertAccountSet(fetched.accountSet, fetched.rawPath, window, attemptId);
  console.log(
    `Synced ${result.accounts} account(s): ${result.inserted} inserted, ${result.updated} updated, ${result.categorized} auto-categorized.`
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`\nSync script failed: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
}