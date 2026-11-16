export type CategoryKind = "expense" | "income" | "transfer";

export interface Account {
  id: string;
  conn_id: string;
  name: string;
  currency: string;
  balance: number | null;
  available_balance: number | null;
  balance_date: number | null;
  is_hidden: number;
}

export interface Category {
  id: number;
  name: string;
  kind: CategoryKind;
  color: string | null;
  is_system: number;
  sort_order: number;
}

export interface Transaction {
  id: string;
  account_id: string;
  external_id: string | null;
  posted_at: number;
  transacted_at: number | null;
  amount: number;
  description: string;
  raw_description: string;
  pending: number;
  category_id: number;
  merchant_key: string;
  notes: string | null;
}

/** A transaction joined with its account + category for display. */
export interface TransactionRow extends Transaction {
  account_name: string;
  category_name: string;
  category_kind: CategoryKind;
  category_color: string | null;
}

export interface MonthlyCashFlow {
  month: string; // YYYY-MM
  income: number;
  expenses: number;
  net: number;
}

export interface MonthCategoryTotal {
  category_id: number;
  category_name: string;
  category_kind: CategoryKind;
  category_color: string | null;
  total: number;
  count: number;
}
