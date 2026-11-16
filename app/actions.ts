"use server";

import { safeRevalidate } from "@/lib/revalidate";
import { getDb } from "@/lib/db";

export interface ActionResult {
  ok: boolean;
  message: string;
  affected?: number;
}

function clean(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}

export async function createCategory(formData: FormData): Promise<ActionResult> {
  const name = clean(String(formData.get("name") ?? ""));
  if (!name) return { ok: false, message: "Category name is required." };
  if (name.length > 40) return { ok: false, message: "Category name is too long (max 40)." };

  const db = getDb();
  const existing = db
    .prepare(`SELECT id FROM categories WHERE name = ? COLLATE NOCASE`)
    .get(name) as { id: number } | undefined;
  if (existing) return { ok: false, message: `"${name}" already exists.` };

  try {
    db.prepare(
      `INSERT INTO categories (name, kind, color, is_system, sort_order, created_at)
       VALUES (?, 'expense', NULL, 0, 500, ?)`
    ).run(name, Math.floor(Date.now() / 1000));
  } catch (err) {
    return { ok: false, message: `Could not create category: ${err}` };
  }

  safeRevalidate("/");
  return { ok: true, message: `Created "${name}".` };
}

export async function deleteCategory(formData: FormData): Promise<ActionResult> {
  const id = Number(formData.get("id"));
  const db = getDb();

  const cat = db.prepare(`SELECT id, name, is_system FROM categories WHERE id = ?`).get(id) as
    | { id: number; name: string; is_system: number }
    | undefined;
  if (!cat) return { ok: false, message: "Category not found." };
  if (cat.is_system) return { ok: false, message: "System categories cannot be deleted." };

  const fallback = db
    .prepare(`SELECT id FROM categories WHERE name = 'Other' COLLATE NOCASE`)
    .get() as { id: number } | undefined;
  if (!fallback) return { ok: false, message: "Fallback category missing." };

  db.exec("BEGIN");
  try {
    db.prepare(`UPDATE transactions SET category_id = ? WHERE category_id = ?`).run(fallback.id, id);
    db.prepare(`DELETE FROM category_rules WHERE category_id = ?`).run(id);
    db.prepare(`DELETE FROM categories WHERE id = ?`).run(id);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    return { ok: false, message: `Could not delete category: ${err}` };
  }

  safeRevalidate("/");
  return { ok: true, message: `Deleted "${cat.name}"; its transactions moved to Other.` };
}

/**
 * Assigns a category to one transaction. When `applyToSimilar` is set, records a
 * merchant-key rule and applies it to every transaction with the same key.
 */
export async function assignCategory(formData: FormData): Promise<ActionResult> {
  const txId = String(formData.get("transactionId") ?? "");
  const categoryId = Number(formData.get("categoryId"));
  const applyToSimilar = formData.get("applyToSimilar") === "true";

  const db = getDb();
  const tx = db
    .prepare(`SELECT id, merchant_key FROM transactions WHERE id = ?`)
    .get(txId) as { id: string; merchant_key: string } | undefined;
  if (!tx) return { ok: false, message: "Transaction not found." };

  const cat = db.prepare(`SELECT id, name FROM categories WHERE id = ?`).get(categoryId) as
    | { id: number; name: string }
    | undefined;
  if (!cat) return { ok: false, message: "Category not found." };

  let affected = 1;
  const now = Math.floor(Date.now() / 1000);

  db.exec("BEGIN");
  try {
    db.prepare(`UPDATE transactions SET category_id = ?, updated_at = ? WHERE id = ?`).run(
      categoryId,
      now,
      txId
    );

    if (applyToSimilar && tx.merchant_key) {
      db.prepare(
        `INSERT INTO category_rules (merchant_key, category_id, source, hit_count, created_at)
         VALUES (?, ?, 'user', 0, ?)
         ON CONFLICT(merchant_key) DO UPDATE SET category_id = excluded.category_id`
      ).run(tx.merchant_key, categoryId, now);

      const res = db
        .prepare(`UPDATE transactions SET category_id = ?, updated_at = ? WHERE merchant_key = ?`)
        .run(categoryId, now, tx.merchant_key);
      affected = Number(res.changes);

      db.prepare(`UPDATE category_rules SET hit_count = ? WHERE merchant_key = ?`).run(
        affected,
        tx.merchant_key
      );
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    return { ok: false, message: `Could not assign category: ${err}` };
  }

  safeRevalidate("/");
  return {
    ok: true,
    message: applyToSimilar
      ? `Moved ${affected} similar transaction${affected === 1 ? "" : "s"} to ${cat.name}.`
      : `Moved 1 transaction to ${cat.name}.`,
    affected,
  };
}

/** Removes a learned merchant-key rule (transactions keep their current category). */
export async function deleteRule(formData: FormData): Promise<ActionResult> {
  const key = String(formData.get("merchantKey") ?? "");
  const db = getDb();
  const res = db.prepare(`DELETE FROM category_rules WHERE merchant_key = ?`).run(key);
  safeRevalidate("/");
  return { ok: true, message: `Removed rule (${Number(res.changes)}).` };
}
