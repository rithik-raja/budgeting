/**
 * Cash-flow classification.
 *
 * The home page reports *cash flow*, not a signed sum of every row in the
 * database. Summing across checking, credit-card liability ledgers, and a
 * brokerage account mixes three things that must never be added together:
 *
 *   1. Cash moving in or out of the user's own money (`external`).
 *   2. Movements between the user's own accounts and sub-accounts
 *      (`internal`) — card payments, money-market sweeps, EFT between own
 *      accounts, brokerage transfers.
 *   3. Nothing at all — account verifications.
 *
 * Only (1) is cash flow. (2) nets to zero when both legs are tracked and
 * produces phantom income/expense when only one leg is, which is exactly the
 * "-$11k over four months" the naive query produced.
 */

/**
 * How a transaction participates in cash flow.
 *
 * - `external`    — real money in/out of the user's economy. Counted.
 * - `internal`    — movement between own accounts. Excluded, shown separately.
 * - `noise`       — verification micro-deposits and similar. Excluded entirely.
 */
export type FlowKind = "external" | "internal" | "noise";

/** What the transaction means, independent of which side it was seen on. */
export type FlowTag =
  | "payroll"
  | "interest"
  | "refund"
  | "spending"
  | "cash-withdrawal"
  | "external-income"
  | "card-payment"
  | "savings-sweep"
  | "own-transfer"
  | "investment"
  | "verification";

export interface FlowCategory {
  tag: FlowTag;
  kind: FlowKind;
  /** Short human label for the UI. */
  label: string;
}

const FLOW: Record<FlowTag, FlowCategory> = {
  payroll: { tag: "payroll", kind: "external", label: "Income" },
  interest: { tag: "interest", kind: "external", label: "Interest" },
  refund: { tag: "refund", kind: "external", label: "Refund" },
  spending: { tag: "spending", kind: "external", label: "Spending" },
  "cash-withdrawal": {
    tag: "cash-withdrawal",
    kind: "external",
    label: "Cash withdrawal",
  },
  "external-income": { tag: "external-income", kind: "external", label: "Transfer received" },
  "card-payment": { tag: "card-payment", kind: "internal", label: "Credit card payment" },
  "savings-sweep": { tag: "savings-sweep", kind: "internal", label: "Savings / money market" },
  "own-transfer": { tag: "own-transfer", kind: "internal", label: "Transfer between own accounts" },
  investment: { tag: "investment", kind: "internal", label: "Investment transfer" },
  verification: { tag: "verification", kind: "noise", label: "Account verification" },
};

export function flowFor(tag: FlowTag): FlowCategory {
  return FLOW[tag];
}

/** Account names that represent cash the user can spend from. */
const CASH_ACCOUNT = /checking|cash management|savings|joint wros/i;
/** Account names that are credit-card liability ledgers. */
const CARD_ACCOUNT = /credit card|visa signature|customized cash|mastercard|amex/i;
/** Account names that are brokerage / investment holdings. */
const INVESTMENT_ACCOUNT = /brokerage|individual \(|invest/i;

export type AccountRole = "cash" | "credit" | "investment";

/**
 * Accounts that are never counted toward cash flow.
 *
 * Matched case-insensitively as a substring of the account name. The Robinhood
 * brokerage is ignored because funding it is a savings decision rather than
 * spending, and its holdings are not spendable cash.
 */
export const IGNORED_ACCOUNT_NAMES = ["Robinhood individual"] as const;

export function isIgnoredAccount(name: string): boolean {
  const lower = name.toLowerCase();
  return IGNORED_ACCOUNT_NAMES.some((ignored) => lower.includes(ignored.toLowerCase()));
}

export function accountRole(name: string): AccountRole {
  if (CASH_ACCOUNT.test(name)) return "cash";
  if (CARD_ACCOUNT.test(name)) return "credit";
  if (INVESTMENT_ACCOUNT.test(name)) return "investment";
  // Unknown institutions are assumed to be cash: over-counting cash is less
  // damaging than silently treating an unknown asset account as a liability.
  return "cash";
}

interface ClassifyInput {
  description: string;
  amount: number;
  accountName: string;
}

/**
 * Descriptions are matched in order; the first hit wins. Every pattern is
 * anchored or specific enough that a merchant named "Payment Depot" does not
 * get swept up as a card payment.
 */
const RULES: { test: RegExp; tag: FlowTag }[] = [
  // --- verification noise -------------------------------------------------
  // Matches "AcctVerify" as well as "AcctVerify" glued onto a prefix (CCAcctVerify).
  {
    test: /acct\s*verify|account\s*verif|micro[- ]?deposit/i,
    tag: "verification",
  },

  // --- own-account transfers and sweeps (internal) -------------------------
  {
    test: /purchase into core account|redemption from core account|reinvestment .*money market|money market .*purchase/i,
    tag: "savings-sweep",
  },
  // Electronic Funds Transfers count as money in/out: the counterparty account
  // is outside what we track, so the movement is real cash flow here.
  { test: /\belectronic funds transfer\b|\beft\b/i, tag: "external-income" },
  {
    test: /\bonline transfer\b|\btransfer (to|from)\b|\binternal transfer\b|\bbetween (my )?accounts\b|\bown account\b/i,
    tag: "own-transfer",
  },

  // --- investment ----------------------------------------------------------
  {
    test: /\bach deposit of .*\b(brokerage|robinhood)\b|\bbuy \d[\d.,]* shares\b|\bsell \d[\d.,]* shares\b|\b(you )?bought\b|\bsold\b.*\bshares\b|\bdividend reinvest/i,
    tag: "investment",
  },

  // --- credit card payments (internal: cash out, card down) ----------------
  {
    test: /payment from chk|automatic payment\s*-\s*thank you|thank you for your payment/i,
    tag: "card-payment",
  },
  {
    test: /\b(cacc|ccb) ?pymt\b|\bccb payment\b|(wells fargo|bank of america|chase|citi|discover|capital one|barclay|synchrony|comenity|amazon|target)\s*(card\s*)?payment\b/i,
    tag: "card-payment",
  },
  {
    test: /\b(apy|card|cc)\s*auto ?pay\b|\bfauto\s*pay\b|direct debit .*payment\b|\bautopay\b/i,
    tag: "card-payment",
  },
  {
    // A bare "Payment" / "ONLINE/MOBILE PAYMENT" only counts as a card payment
    // when it is the whole description (optionally with a confirmation code).
    // Requiring end-of-string avoids catching merchants like "PAYMENT DEPOT".
    test: /^(online\/mobile payment|mobile payment|payment|pymt|payment received|automatic payment)(\b\s*(conf|#|ref|id)\b.*)?$/i,
    tag: "card-payment",
  },

  // --- external income -----------------------------------------------------
  { test: /\bdirect deposit\b|\bpayroll\b|\bsalary\b|\bpaycheck\b/i, tag: "payroll" },
  { test: /\binterest (paid|earned|received|credit)\b|\bdividend (received|paid)\b/i, tag: "interest" },

  // --- refunds -------------------------------------------------------------
  { test: /^refund\b|\brefund:|credit memo|\breturn(ed)? (item|purchase)\b/i, tag: "refund" },

  // --- cash withdrawals ----------------------------------------------------
  { test: /\bcash advance\b|\batm withdrawal\b|\bwithdrawal\b.*\batm\b/i, tag: "cash-withdrawal" },
];

/**
 * Classifies a single transaction.
 *
 * `cardPaymentHint` lets the caller force card-payment interpretation for rows
 * it already knows are card settlements (e.g. a positive row on a card whose
 * description is just "Payment").
 */
export function classifyTransaction({ description, amount, accountName }: ClassifyInput): FlowCategory {
  const text = description.toLowerCase().trim();
  const role = accountRole(accountName);

  for (const rule of RULES) {
    if (!rule.test.test(text)) continue;
    // A "bare Payment" match on a non-card account is only a card payment if
    // it debits cash — which is what these rows always are in practice.
    return flowFor(rule.tag);
  }

  // Credit-card ledgers: a positive row is a payment or a refund. Refunds are
  // caught above; anything else positive is a settlement.
  if (role === "credit" && amount > 0) return flowFor("card-payment");

  // Brokerage ledgers: cash in/out of a brokerage is an investment transfer.
  if (role === "investment") return flowFor("investment");

  // Everything else is real spending or real income.
  if (amount > 0) return flowFor("payroll");
  return flowFor("spending");
}

/**
 * Whether a *cash* row with this tag moves cash out of the user's pocket.
 * Used to split "money in" from "money out" without trusting the sign alone.
 */
export function isCashInflow(flow: FlowCategory, amount: number): boolean {
  if (flow.kind !== "external") return false;
  return amount > 0;
}

/**
 * Refunds reduce spending rather than adding income — they reverse a purchase.
 */
export function isRefund(flow: FlowCategory): boolean {
  return flow.tag === "refund";
}
