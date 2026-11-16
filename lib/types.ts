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
  color: string | null;
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
}

export interface MonthlyCashFlow {
  month: string; // YYYY-MM
  /** Real money in (payroll, interest, dividends). */
  income: number;
  /** Real money out, net of refunds. */
  expenses: number;
  /** income - expenses. */
  net: number;
  /** Net of movements between the user's own accounts. Excluded from `net`. */
  internalNet: number;
  internalCount: number;
  transactions: number;
}

export interface MonthCategoryTotal {
  category_id: number;
  category_name: string;
  total: number;
  count: number;
}
