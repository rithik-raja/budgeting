import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

/** Directory for cached SimpleFIN responses (never shipped to the client). */
export const SIMPLEFIN_DIR = path.resolve(process.cwd(), "data", "simplefin");
export const ACCESS_URL_PATH = path.join(SIMPLEFIN_DIR, "access-url.txt");
export const RAW_DIR = path.join(SIMPLEFIN_DIR, "raw");
export const LATEST_PATH = path.join(SIMPLEFIN_DIR, "latest.json");

export interface SimpleFinTransaction {
  id: string;
  posted: number;
  amount: string;
  description: string;
  transacted_at?: number;
  pending?: boolean;
  extra?: Record<string, unknown>;
}

export interface SimpleFinAccount {
  id: string;
  name: string;
  conn_id: string;
  currency: string;
  balance: string;
  "available-balance"?: string;
  "balance-date": number;
  transactions?: SimpleFinTransaction[];
}

export interface SimpleFinError {
  code: string;
  msg: string;
  conn_id?: string;
  account_id?: string;
}

export interface SimpleFinAccountSet {
  errlist: SimpleFinError[];
  connections: { conn_id: string; name: string }[];
  accounts: SimpleFinAccount[];
}

/**
 * Resolves the Access URL.
 * The setup token is one-time-use, so once claimed the resulting Access URL is
 * persisted to disk and reused for every later sync.
 */
async function resolveAccessUrl(): Promise<string> {
  if (existsSync(ACCESS_URL_PATH)) {
    const saved = readFileSync(ACCESS_URL_PATH, "utf-8").trim();
    if (saved) return saved;
  }

  const raw = process.env.SIMPLEFIN_TOKEN?.trim();
  if (!raw) {
    throw new Error(
      "SIMPLEFIN_TOKEN is not set. Add it to .env (server-only, no NEXT_PUBLIC_ prefix)."
    );
  }

  // A persisted Access URL itself looks like https://user:pass@host/simplefin
  if (raw.startsWith("http")) {
    persistAccessUrl(raw);
    return raw;
  }

  const claimUrl = Buffer.from(raw, "base64").toString("utf-8").trim();
  if (!claimUrl.startsWith("http")) {
    throw new Error("SIMPLEFIN_TOKEN did not decode to a URL.");
  }
  if (!claimUrl.startsWith("https://")) {
    throw new Error("Refusing to claim a non-HTTPS SimpleFIN token.");
  }

  console.log("Claiming setup token (one-time operation)...");
  const res = await fetch(claimUrl, {
    method: "POST",
    headers: { "Content-Length": "0" },
  });

  if (res.status === 403) {
    throw new Error(
      "Setup token was rejected or already claimed (403).\n" +
        "  The token in .env is a one-time-use SETUP token, and it has already been used.\n" +
        "  Fix: generate a fresh token at https://beta-bridge.simplefin.org/simplefin/create\n" +
        "  and put it in .env as SIMPLEFIN_TOKEN=.\n" +
        "  (If you have the Access URL from an earlier claim, save it to data/simplefin/access-url.txt instead.)"
    );
  }
  if (!res.ok) {
    throw new Error(`Claim failed: HTTP ${res.status} ${await res.text()}`);
  }

  const accessUrl = (await res.text()).trim();
  if (!accessUrl.startsWith("https://")) {
    throw new Error("SimpleFIN returned a non-HTTPS Access URL; refusing to store it.");
  }
  persistAccessUrl(accessUrl);
  return accessUrl;
}

function persistAccessUrl(accessUrl: string) {
  mkdirSync(SIMPLEFIN_DIR, { recursive: true });
  writeFileSync(ACCESS_URL_PATH, accessUrl, { encoding: "utf-8", mode: 0o600 });
  console.log(`Saved Access URL to ${ACCESS_URL_PATH} (mode 600).`);
}

/** Splits an Access URL's embedded basic-auth credentials into a fetch target. */
function splitAccessUrl(accessUrl: string) {
  const u = new URL(accessUrl);
  const username = decodeURIComponent(u.username);
  const password = decodeURIComponent(u.password);
  u.username = "";
  u.password = "";
  const base = u.toString().replace(/\/$/, "");
  const auth = Buffer.from(`${username}:${password}`).toString("base64");
  return { base, auth };
}

/**
 * GET /accounts. Saves the raw JSON response to disk before returning so a
 * failed parse never costs a second API request.
 */
export async function fetchAccounts(params: {
  startDate?: number;
  endDate?: number;
  pending?: boolean;
}): Promise<{ accountSet: SimpleFinAccountSet; rawPath: string }> {
  const accessUrl = await resolveAccessUrl();
  const { base, auth } = splitAccessUrl(accessUrl);

  const url = new URL(`${base}/accounts`);
  url.searchParams.set("version", "2");
  if (params.startDate !== undefined) {
    url.searchParams.set("start-date", String(params.startDate));
  }
  if (params.endDate !== undefined) {
    url.searchParams.set("end-date", String(params.endDate));
  }
  if (params.pending) url.searchParams.set("pending", "1");

  const res = await fetch(url, {
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
      "User-Agent": "budgeting-local/1.0",
    },
    signal: AbortSignal.timeout(60_000),
  });

  const body = await res.text();

  if (res.status === 403) {
    throw new Error(
      "SimpleFIN rejected the credentials (403). Access may have been revoked — re-connect at https://beta-bridge.simplefin.org"
    );
  }
  if (res.status === 402) {
    throw new Error("SimpleFIN returned 402 Payment required.");
  }
  if (res.status === 503 || res.status === 502 || res.status === 504) {
    throw new Error(
      `SimpleFIN is temporarily unavailable (HTTP ${res.status}). This is usually a ` +
        `bridge-side outage, not a credentials problem — retry later.`
    );
  }
  if (!res.ok) {
    const detail = body.trim() ? ` — ${body.slice(0, 500)}` : " (empty response body)";
    throw new Error(`SimpleFIN /accounts failed: HTTP ${res.status}${detail}`);
  }

  // Cache first, parse second.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  mkdirSync(RAW_DIR, { recursive: true });
  const rawPath = path.join(RAW_DIR, `${stamp}-accounts.json`);
  writeFileSync(rawPath, body, "utf-8");
  writeFileSync(LATEST_PATH, body, "utf-8");
  console.log(`Cached raw response -> ${rawPath}`);

  const accountSet = JSON.parse(body) as SimpleFinAccountSet;

  if (accountSet.errlist?.length) {
    for (const e of accountSet.errlist) {
      console.error(`  SimpleFIN error [${e.code}] ${e.msg}`);
    }
  }

  return { accountSet, rawPath };
}
