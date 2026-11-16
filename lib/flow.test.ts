/**
 * Cash-flow classification tests.
 *
 * Run with: node --test --experimental-strip-types lib/flow.test.ts
 *
 * These lock in the distinctions that caused the home page to report a
 * multi-thousand-dollar phantom loss: card payments, money-market sweeps, EFTs
 * between own accounts, and brokerage transfers must never read as income or
 * spending.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { accountRole, classifyTransaction } from "./flow.ts";

const CASH = "Cash Management (Joint WROS) (6711)";
const CARD = "Customized Cash Rewards Visa Signature- 4905 (4905)";
const CARD2 = "Robinhood Credit Card **0012 (0012)";
const BROKER = "Robinhood individual (0301)";

function kind(description: string, amount: number, accountName: string): string {
  return classifyTransaction({ description, amount, accountName }).kind;
}

function tag(description: string, amount: number, accountName: string): string {
  return classifyTransaction({ description, amount, accountName }).tag;
}

test("account roles", () => {
  assert.equal(accountRole(CASH), "cash");
  assert.equal(accountRole("Wells Fargo Checking"), "cash");
  assert.equal(accountRole(CARD), "credit");
  assert.equal(accountRole("Visa Signature® credit card (0348)"), "credit");
  assert.equal(accountRole(BROKER), "investment");
});

test("payroll and dividends are external income", () => {
  for (const d of [
    "DIRECT DEPOSIT HUMANA PAYROPAYROLL (Cash)",
    "DIRECT DEPOSIT 86607 DNA COPAYROLL (Cash)",
    "Payroll deposit",
  ]) {
    assert.equal(kind(d, 2658.41, CASH), "external", d);
    assert.equal(tag(d, 2658.41, CASH), "payroll", d);
  }
  assert.equal(tag("DIVIDEND RECEIVED FIDELITY GOVERNMENT MONEY MARKET (SPAXX) (Cash)", 48.07, CASH), "interest");
});

test("merchant spending is external", () => {
  assert.equal(kind("PUBLIX #157 FORT MYERS FL", -49.75, CARD), "external");
  assert.equal(tag("PUBLIX #157 FORT MYERS FL", -49.75, CARD), "spending");
  assert.equal(kind("DIRECT DEBIT SUN WEST MORTGMORTGAGE (Cash)", -3326.8, CASH), "external");
  assert.equal(kind("DEBIT CARD PURCHASE HUMBERSTONE ANIMAL HOS (Cash)", -278.5, CASH), "external");
});

test("merchant names containing payment/interest words are NOT transfers", () => {
  // Regression: a loose /payment/ or /interest/ match would swallow these.
  assert.equal(tag("PAYMENT DEPOT LLC", -50, CASH), "spending");
  assert.equal(tag("INTEREST FREE FINANCING", -50, CARD), "spending");
  assert.equal(tag("TRANSFEREE JOHN DOE", -50, CASH), "spending");
});

test("card payments are internal on both legs", () => {
  // Card side: payment credited to the card.
  assert.equal(kind("AUTOMATIC PAYMENT - THANK YOU", 358.63, CARD), "internal");
  assert.equal(kind("Payment", 76.88, CARD2), "internal");
  assert.equal(kind("ONLINE/MOBILE PAYMENT CONF#xu74zcg0b", 2000, CARD), "internal");
  assert.equal(kind("PAYMENT FROM CHK 9125 CONF#x1jw7buad", 500, CARD), "internal");
  // Cash side: the matching debit.
  assert.equal(kind("DIRECT DEBIT WELLS FARGO CACCPYMT (Cash)", -864.46, CASH), "internal");
  assert.equal(kind("DIRECT DEBIT COMN CAP APY FAUTO PAY (Cash)", -204.04, CASH), "internal");
  assert.equal(kind("DIRECT DEBIT Robinhood CCB Payment (Cash)", -1076, CASH), "internal");
  assert.equal(kind("DIRECT DEBIT BANK OF AMERICAPAYMENT (Cash)", -2000, CASH), "internal");
});

test("money-market sweeps are internal", () => {
  for (const d of [
    "PURCHASE INTO CORE ACCOUNT FIDELITY GOVERNMENT MONEY MARKET (SPAXX) (Cash)",
    "PURCHASE INTO CORE ACCOUNT FIDELITY GOVERNMENT MONEY MARKET (SPAXX) MORNING TRADE (Cash)",
    "REINVESTMENT FIDELITY GOVERNMENT MONEY MARKET (SPAXX) (Cash)",
    "REDEMPTION FROM CORE ACCOUNT FIDELITY GOVERNMENT MONEY MARKET (SPAXX) MORNING TRADE (Cash)",
  ]) {
    assert.equal(kind(d, -2451, CASH), "internal", d);
    assert.equal(tag(d, -2451, CASH), "savings-sweep", d);
  }
});

test("EFTs count as real money in/out", () => {
  assert.equal(kind("Electronic Funds Transfer Received (Cash)", 2451, CASH), "external");
  assert.equal(kind("Electronic Funds Transfer Received (Cash)", 3000, CASH), "external");
});

test("brokerage movements are internal", () => {
  assert.equal(kind("buy 39.726027 shares of WisdomTree Floating Rate Treasury Fund for $50.37 each", -2001, BROKER), "internal");
  assert.equal(kind("ACH deposit of $2001 into Robinhood Brokerage account ending in 0301", 2001, BROKER), "internal");
  // Positive row on a brokerage with no description match is still a transfer.
  assert.equal(kind("something", 500, BROKER), "internal");
});

test("refunds are external and identified", () => {
  assert.equal(tag("Refund: Microsoft", 47.87, CARD2), "refund");
});

test("verification micro-deposits are noise", () => {
  assert.equal(kind("DIRECT DEPOSIT Robinhood CCAcctVerify (Cash)", 0.55, CASH), "noise");
  assert.equal(kind("DIRECT DEBIT Robinhood CCB AcctVerify (Cash)", -0.58, CASH), "noise");
});

test("cash advances are external withdrawals", () => {
  assert.equal(kind("CASH ADVANCE PNC BANK FORT MYERS FL 101226 AUTHID:217378 (Cash)", -200, CASH), "external");
  assert.equal(tag("CASH ADVANCE PNC BANK FORT MYERS FL 101226 AUTHID:217378 (Cash)", -200, CASH), "cash-withdrawal");
});
