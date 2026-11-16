"use server";

import { FALLBACK_CATEGORY, getDb } from "@/lib/db";
import { safeRevalidate } from "@/lib/revalidate";

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
      `INSERT INTO categories (name, color, sort_order, created_at)
       VALUES (?, NULL, 500, ?)`
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

  const cat = db.prepare(`SELECT id, name FROM categories WHERE id = ?`).get(id) as
    | { id: number; name: string }
    | undefined;
  if (!cat) return { ok: false, message: "Category not found." };
  if (cat.name.toLowerCase() === FALLBACK_CATEGORY.toLowerCase()) {
    return { ok: false, message: `${FALLBACK_CATEGORY} is the fallback and cannot be deleted.` };
  }

  const fallback = db
    .prepare(`SELECT id FROM categories WHERE name = ? COLLATE NOCASE`)
    .get(FALLBACK_CATEGORY) as { id: number } | undefined;
  if (!fallback) return { ok: false, message: "Fallback category missing." };

  db.exec("BEGIN");
  try {
    db.prepare(`UPDATE transactions SET category_id = ? WHERE category_id = ?`).run(fallback.id, id);
    db.prepare(`DELETE FROM categories WHERE id = ?`).run(id);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    return { ok: false, message: `Could not delete category: ${err}` };
  }

  safeRevalidate("/");
  return { ok: true, message: `Deleted "${cat.name}"; its transactions moved to ${FALLBACK_CATEGORY}.` };
}

/** Assigns one transaction. Existing sync/manual category choices are otherwise left alone. */
export async function assignCategory(formData: FormData): Promise<ActionResult> {
  const txId = String(formData.get("transactionId") ?? "");
  const categoryId = Number(formData.get("categoryId"));

  const db = getDb();
  const tx = db.prepare(`SELECT id FROM transactions WHERE id = ?`).get(txId) as
    | { id: string }
    | undefined;
  if (!tx) return { ok: false, message: "Transaction not found." };

  const cat = db.prepare(`SELECT id, name FROM categories WHERE id = ?`).get(categoryId) as
    | { id: number; name: string }
    | undefined;
  if (!cat) return { ok: false, message: "Category not found." };

  db.prepare(`UPDATE transactions SET category_id = ?, updated_at = ? WHERE id = ?`).run(
    categoryId,
    Math.floor(Date.now() / 1000),
    txId
  );

  safeRevalidate("/");
  return { ok: true, message: `Set category to ${cat.name}.` };
}
