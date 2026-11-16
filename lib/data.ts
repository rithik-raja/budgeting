import { getDb } from "@/lib/db";
import {
  classifyTransaction,
  isIgnoredAccount,
  isRefund,
  type FlowCategory,
} from "@/lib/flow";
import type {
  Account,
  Category,
  MonthCategoryTotal,
  MonthlyCashFlow,
  TransactionRow,
} from "@/lib/types";

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * node:sqlite returns null-prototype rows, which cannot be serialized across the
 * Server -> Client Component boundary. Convert to plain objects.
 */
function plain<T>(rows: unknown[]): T[] {
  return rows.map((r) => ({ ...(r as object) })) as T[];
}

function plainOne<T>(row: unknown): T | null {
  return row ? ({ ...(row as object) } as T) : null;
}

export function listAccounts(): Account[] {
  return plain<Account>(getDb().prepare(`SELECT * FROM accounts ORDER BY name`).all());
}

export function listCategories(): Category[] {
  return plain<Category>(
    getDb()
      .prepare(`SELECT id, name, color, sort_order FROM categories ORDER BY sort_order, name`)
      .all()
  );
}

export function countTransactions(): number {
  const row = getDb().prepare(`SELECT COUNT(*) AS n FROM transactions`).get() as { n: number };
  return row.n;
}

export function latestSync(): {
  started_at: number;
  status: string;
  inserted: number;
  updated: number;
  error: string | null;
} | null {
  return plainOne(
    getDb()
      .prepare(
        `SELECT started_at, status, inserted, updated, error FROM sync_log ORDER BY id DESC LIMIT 1`
      )
      .get()
  );
}

/** A transaction joined with the flow classification derived from its account. */
interface FlowRow {
  month: string;
  posted_at: number;
  amount: number;
  pending: number;
  account_name: string;
  flow: FlowCategory;
}

/**
 * Loads every transaction with its flow classification, pending included.
 *
 * Pending rows count toward the month they are shown in: `scripts/sync.ts`
 * stores `transacted_at` (falling back to the sync time) as `posted_at` when an
 * institution sends `posted: 0`, so a pending row always has a usable date.
 */
function loadFlowRows(): FlowRow[] {
  const rows = plain<Omit<FlowRow, "flow"> & { description: string }>(
    getDb()
      .prepare(
        `SELECT strftime('%Y-%m', t.posted_at, 'unixepoch') AS month,
                t.posted_at, t.amount, t.pending, t.description,
                a.name AS account_name
           FROM transactions t
           JOIN accounts a ON a.id = t.account_id
          WHERE a.is_hidden = 0
          ORDER BY t.posted_at`
      )
      .all()
  );

  return rows
    .filter((r) => !isIgnoredAccount(r.account_name))
    .map((r) => ({
      month: r.month,
      posted_at: r.posted_at,
      amount: r.amount,
      pending: r.pending,
      account_name: r.account_name,
      flow: classifyTransaction({
        description: r.description,
        amount: r.amount,
        accountName: r.account_name,
      }),
    }));
}

/**
 * Monthly cash flow.
 *
 * Counts only `external` flows: money genuinely entering or leaving the user's
 * own money. Credit-card payments, money-market sweeps, transfers between own
 * accounts, and brokerage funding are `internal` and reported separately so
 * they are never mistaken for income or spending.
 *
 * Spending is shown net of refunds, because a refund reverses a purchase.
 */
export function computeMonthlyCashFlow(): MonthlyCashFlow[] {
  const rows = loadFlowRows();

  const byMonth = new Map<string, FlowRow[]>();
  for (const r of rows) {
    const list = byMonth.get(r.month);
    if (list) list.push(r);
    else byMonth.set(r.month, [r]);
  }

  const months = [...byMonth.keys()].sort();
  const out: MonthlyCashFlow[] = [];

  for (const month of months) {
    const monthRows = byMonth.get(month) ?? [];

    let income = 0;
    let spending = 0;
    let refunds = 0;
    let internalNet = 0;
    let internalCount = 0;

    for (const r of monthRows) {
      if (r.flow.kind === "noise") continue;
      if (r.flow.kind === "internal") {
        internalNet += r.amount;
        internalCount += 1;
        continue;
      }
      if (isRefund(r.flow)) {
        refunds += r.amount;
      } else if (r.amount > 0) {
        income += r.amount;
      } else {
        spending += -r.amount;
      }
    }

    const net = income - spending + refunds;

    out.push({
      month,
      income: round(income),
      expenses: round(spending - refunds),
      net: round(net),
      internalNet: round(internalNet),
      internalCount,
      transactions: monthRows.length,
    });
  }

  return out;
}

/**
 * Pending transactions, summarized.
 *
 * Pending rows are already included in cash flow (see `loadFlowRows`); this is
 * only the count and magnitude, for the month-page badge.
 */
export function pendingSummary(): { count: number; outflows: number; inflows: number } {
  const row = plainOne<{ n: number; outflows: number; inflows: number }>(
    getDb()
      .prepare(
        `SELECT COUNT(*) AS n,
                SUM(CASE WHEN t.amount < 0 THEN -t.amount ELSE 0 END) AS outflows,
                SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END) AS inflows
           FROM transactions t
           JOIN accounts a ON a.id = t.account_id
          WHERE t.pending = 1`
      )
      .get()
  );
  return {
    count: row?.n ?? 0,
    outflows: round(row?.outflows ?? 0),
    inflows: round(row?.inflows ?? 0),
  };
}

/** Total number of months and transactions, for the home page subtitle. */
export function summaryCounts(): { months: number; transactions: number; transferCount: number } {
  const db = getDb();
  const a = db
    .prepare(`SELECT COUNT(DISTINCT strftime('%Y-%m', posted_at, 'unixepoch')) AS months FROM transactions`)
    .get() as { months: number };
  const b = db.prepare(`SELECT COUNT(*) AS n FROM transactions`).get() as { n: number };
  return { months: a.months, transactions: b.n, transferCount: 0 };
}

/**
 * Per-category totals for a month.
 *
 * Excludes internal and noise flows so the chips sum to the month's income and
 * spending figures instead of including card payments and money-market sweeps.
 * Amounts are signed sums, so a refund inside a category reduces that category.
 */
export function monthCategoryTotals(month: string): MonthCategoryTotal[] {
  const [year, mo] = month.split("-").map(Number);
  const from = Date.UTC(year, mo - 1, 1) / 1000;
  const to = Date.UTC(year, mo, 1) / 1000;

  const rows = plain<{
    category_id: number;
    category_name: string;
    description: string;
    account_name: string;
    amount: number;
  }>(
    getDb()
      .prepare(
        `SELECT c.id AS category_id, c.name AS category_name,
                t.description, a.name AS account_name, t.amount
           FROM transactions t
           JOIN categories c ON c.id = t.category_id
           JOIN accounts a ON a.id = t.account_id
          WHERE t.posted_at >= ? AND t.posted_at < ?
            AND t.pending = 0
            AND a.is_hidden = 0`
      )
      .all(from, to)
  );

  const totals = new Map<number, MonthCategoryTotal>();
  for (const r of rows) {
    if (isIgnoredAccount(r.account_name)) continue;
    const flow = classifyTransaction({
      description: r.description,
      amount: r.amount,
      accountName: r.account_name,
    });
    if (flow.kind !== "external") continue;

    const existing = totals.get(r.category_id);
    if (existing) {
      existing.total += Math.abs(r.amount);
      existing.count += 1;
    } else {
      totals.set(r.category_id, {
        category_id: r.category_id,
        category_name: r.category_name,
        total: Math.abs(r.amount),
        count: 1,
      });
    }
  }

  return [...totals.values()]
    .map((t) => ({ ...t, total: round(t.total) }))
    .sort((a, b) => b.total - a.total);
}

/**
 * Per-transaction cash-flow classification for a month's list view.
 *
 * The month page must label rows with the same logic the home page uses, or the
 * two disagree. Returns a map of transaction id -> flow tag.
 */
export function monthFlowTags(month: string): Record<string, string> {
  const [year, mo] = month.split("-").map(Number);
  const from = Date.UTC(year, mo - 1, 1) / 1000;
  const to = Date.UTC(year, mo, 1) / 1000;

  const rows = plain<{
    id: string;
    description: string;
    amount: number;
    account_name: string;
  }>(
    getDb()
      .prepare(
        `SELECT t.id, t.description, t.amount, a.name AS account_name
           FROM transactions t
           JOIN accounts a ON a.id = t.account_id
          WHERE t.posted_at >= ? AND t.posted_at < ?`
      )
      .all(from, to)
  );

  const tags: Record<string, string> = {};
  for (const r of rows) {
    const flow = classifyTransaction({
      description: r.description,
      amount: r.amount,
      accountName: r.account_name,
    });
    tags[r.id] = flow.tag;
  }
  return tags;
}

export function monthTransactions(month: string): TransactionRow[] {
  const [year, mo] = month.split("-").map(Number);
  const from = Date.UTC(year, mo - 1, 1) / 1000;
  const to = Date.UTC(year, mo, 1) / 1000;

  const rows = plain<TransactionRow>(
    getDb()
      .prepare(
        `SELECT t.*, a.name AS account_name, c.name AS category_name
           FROM transactions t
           JOIN accounts a ON a.id = t.account_id
           JOIN categories c ON c.id = t.category_id
          WHERE t.posted_at >= ? AND t.posted_at < ?
          ORDER BY t.posted_at ASC, t.description ASC`
      )
      .all(from, to)
  );

  // The ignore list is applied here too, so the month view can never show rows
  // the home page excludes.
  return rows.filter((r) => !isIgnoredAccount(r.account_name));
}

export function listMonths(): string[] {
  return plain<{ month: string }>(
    getDb()
      .prepare(
        `SELECT DISTINCT strftime('%Y-%m', posted_at, 'unixepoch') AS month
           FROM transactions ORDER BY month`
      )
      .all()
  ).map((r) => r.month);
}
