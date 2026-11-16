import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";

const DATA_DIR = path.resolve(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "app.db");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id                TEXT PRIMARY KEY,
  conn_id           TEXT NOT NULL,
  name              TEXT NOT NULL,
  currency          TEXT NOT NULL DEFAULT 'USD',
  balance           REAL,
  available_balance REAL,
  balance_date      INTEGER,
  is_hidden         INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  kind       TEXT NOT NULL DEFAULT 'expense',
  color      TEXT,
  is_system  INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  id              TEXT PRIMARY KEY,
  account_id      TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  external_id     TEXT,
  posted_at       INTEGER NOT NULL,
  transacted_at   INTEGER,
  amount          REAL NOT NULL,
  description     TEXT NOT NULL,
  raw_description TEXT NOT NULL,
  pending         INTEGER NOT NULL DEFAULT 0,
  category_id     INTEGER NOT NULL REFERENCES categories(id),
  merchant_key    TEXT NOT NULL,
  notes           TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tx_account_external
  ON transactions(account_id, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tx_posted ON transactions(posted_at);
CREATE INDEX IF NOT EXISTS idx_tx_category ON transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_tx_merchant_key ON transactions(merchant_key);

CREATE TABLE IF NOT EXISTS category_rules (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  merchant_key TEXT NOT NULL UNIQUE,
  category_id  INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  source       TEXT NOT NULL DEFAULT 'user',
  hit_count    INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at  INTEGER NOT NULL,
  finished_at INTEGER,
  status      TEXT NOT NULL,
  start_date  INTEGER,
  end_date    INTEGER,
  accounts    INTEGER DEFAULT 0,
  inserted    INTEGER DEFAULT 0,
  updated     INTEGER DEFAULT 0,
  error       TEXT,
  raw_path    TEXT
);
`;

/** Categories present on a fresh install. `Other` is the required fallback. */
const SEED_CATEGORIES: {
  name: string;
  kind: string;
  is_system: number;
  sort_order: number;
  color: string;
}[] = [
  { name: "Groceries", kind: "expense", is_system: 1, sort_order: 10, color: "emerald" },
  { name: "Bills", kind: "expense", is_system: 1, sort_order: 20, color: "sky" },
  { name: "Other", kind: "expense", is_system: 1, sort_order: 1000, color: "zinc" },
  { name: "Transfer", kind: "transfer", is_system: 1, sort_order: 2000, color: "zinc" },
  { name: "Income", kind: "income", is_system: 1, sort_order: 2001, color: "emerald" },
];

let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (db) return db;

  mkdirSync(DATA_DIR, { recursive: true });
  const instance = new DatabaseSync(DB_PATH);

  instance.exec("PRAGMA journal_mode = WAL;");
  instance.exec("PRAGMA foreign_keys = ON;");
  instance.exec("PRAGMA busy_timeout = 5000;");
  instance.exec(SCHEMA);

  seedCategories(instance);

  db = instance;
  return db;
}

function seedCategories(instance: DatabaseSync) {
  const insert = instance.prepare(
    `INSERT INTO categories (name, kind, color, is_system, sort_order, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(name) DO NOTHING`
  );
  const now = Math.floor(Date.now() / 1000);
  for (const c of SEED_CATEGORIES) {
    insert.run(c.name, c.kind, c.color, c.is_system, c.sort_order, now);
  }
}

export const SYSTEM_CATEGORIES = {
  /** Applied when nothing else matches. */
  fallback: "Other",
  transfer: "Transfer",
  income: "Income",
} as const;

export { DB_PATH, DATA_DIR };
