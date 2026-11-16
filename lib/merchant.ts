/**
 * Normalizes a bank description into a stable key used to group "similar"
 * transactions, so a category assignment can apply to every matching row.
 *
 * Examples:
 *   "TST* LEGEND BNG NAPLES FL"        -> "legend bng"
 *   "SQ *FOXTAIL COFFEE #1234"         -> "foxtail coffee"
 *   "AMAZON MKTPL*AA1B2C3 SEATTLE WA"  -> "amazon mktpl"
 */
export function merchantKey(description: string): string {
  let s = description.toLowerCase();

  // Repeatedly strip payment-processor prefixes; some rows stack them.
  const PREFIX =
    /^(tst\s*\*|sq\s*\*|sp\s*\*|pp\s*\*|paypal\s*\*|pos\s+|ach\s+debit\s+|ach\s+credit\s+|debit\s+card\s+purchase\s+|purchase\s+authorized\s+on\s+|recurring\s+payment\s+|card\s+purchase\s+|external\s+withdrawal\s+)/;
  let prev = "";
  while (prev !== s) {
    prev = s;
    s = s.replace(PREFIX, "");
  }
  // Drop a leading "purchase authorized on MM/DD" style date prologue.
  s = s.replace(/^\d{1,2}\/\d{1,2}(\/\d{2,4})?\s+/, "");

  // Order matters: strip hashes before bare digits so "#0621" becomes "0621" then vanishes.
  s = s.replace(/#\s*\d+/g, " ");

  // Drop masked card numbers, long reference codes, dates.
  s = s.replace(/\bxx+\d{2,}\b/g, " ");
  s = s.replace(/\b[0-9a-f]{8,}\b/g, " ");
  s = s.replace(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g, " ");
  // Alphanumeric reference tokens that carry embedded digits (AA1B2C3, T3K9Q).
  s = s.replace(/\b(?=[a-z0-9]*\d)(?=[a-z0-9]*[a-z])[a-z0-9]{5,}\b/g, " ");

  // Normalize punctuation / whitespace.
  s = s.replace(/[^a-z0-9\s&]/g, " ");
  s = s.replace(/\s+/g, " ").trim();

  // Store / terminal numbers (3+ digits) are noise and vary per location.
  s = s.replace(/\b\d{3,}\b/g, " ");

  // Strip a trailing 2-letter state code ("... FORT MYERS FL").
  s = s.replace(/\s+\b[a-z]{2}\b$/g, "");

  return s.replace(/\s+/g, " ").trim() || description.toLowerCase().trim();
}

/** Number of transactions sharing a merchant key — used for "apply to N similar". */
export function isSimilar(a: string, b: string): boolean {
  return a === b;
}
