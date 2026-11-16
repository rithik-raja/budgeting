import { getDb, SYSTEM_CATEGORIES } from "@/lib/db";
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
    getDb().prepare(`SELECT * FROM categories ORDER BY sort_order, name`).all()
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

/**
 * Monthly income / expenses / net.
 * Excludes transfer-category rows so card payments aren't double counted.
 */
export function computeMonthlyCashFlow(): MonthlyCashFlow[] {
  const rows = plain<{ month: string; income: number; expenses: number }>(
    getDb()
      .prepare(
        `SELECT strftime('%Y-%m', t.posted_at, 'unixepoch') AS month,
                SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END) AS income,
                SUM(CASE WHEN t.amount < 0 THEN -t.amount ELSE 0 END) AS expenses
           FROM transactions t
           JOIN categories c ON c.id = t.category_id
          WHERE c.kind != 'transfer'
          GROUP BY month
          ORDER BY month`
      )
      .all()
  );

  return rows.map((r) => ({
    month: r.month,
    income: round(r.income),
    expenses: round(r.expenses),
    net: round(r.income - r.expenses),
  }));
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

/** Per-category totals for a month (transfers included — the caller filters). */
export function monthCategoryTotals(month: string): MonthCategoryTotal[] {
  const [year, mo] = month.split("-").map(Number);
  const from = Date.UTC(year, mo - 1, 1) / 1000;
  const to = Date.UTC(year, mo, 1) / 1000;

  const rows = plain<MonthCategoryTotal>(
    getDb()
      .prepare(
        `SELECT c.id AS category_id, c.name AS category_name, c.kind AS category_kind,
                c.color AS category_color, SUM(ABS(t.amount)) AS total, COUNT(*) AS count
           FROM transactions t
           JOIN categories c ON c.id = t.category_id
          WHERE t.posted_at >= ? AND t.posted_at < ?
          GROUP BY c.id
          ORDER BY total DESC`
      )
      .all(from, to)
  );

  return rows.map((r) => ({ ...r, total: round(r.total) }));
}

export function monthTransactions(month: string): TransactionRow[] {
  const [year, mo] = month.split("-").map(Number);
  const from = Date.UTC(year, mo - 1, 1) / 1000;
  const to = Date.UTC(year, mo, 1) / 1000;

  return plain<TransactionRow>(
    getDb()
      .prepare(
        `SELECT t.*, a.name AS account_name, c.name AS category_name,
                c.kind AS category_kind, c.color AS category_color
           FROM transactions t
           JOIN accounts a ON a.id = t.account_id
           JOIN categories c ON c.id = t.category_id
          WHERE t.posted_at >= ? AND t.posted_at < ?
          ORDER BY t.posted_at ASC, t.description ASC`
      )
      .all(from, to)
  );
}

/** How many transactions would be affected by a rule on this merchant key. */
export function merchantKeyCount(key: string): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM transactions WHERE merchant_key = ?`)
    .get(key) as { n: number };
  return row.n;
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

export { SYSTEM_CATEGORIES };
