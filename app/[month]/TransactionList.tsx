"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { assignCategory, createCategory } from "@/app/actions";
import type { Category, MonthCategoryTotal, TransactionRow } from "@/lib/types";
import { formatCurrency, formatEpoch, formatMonthLong } from "@/lib/format";

interface Props {
  transactions: TransactionRow[];
  categories: Category[];
  categoryTotals: MonthCategoryTotal[];
  month: string;
}

export default function TransactionList({
  transactions,
  categories,
  categoryTotals,
  month,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [showTransfers, setShowTransfers] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<string>("all");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  // Which row has its category editor open, plus the pending "apply to similar" choice.
  const [editing, setEditing] = useState<{
    tx: TransactionRow;
    similarCount: number;
  } | null>(null);

  const accounts = useMemo(() => {
    const map = new Map<string, string>();
    for (const tx of transactions) map.set(tx.account_id, tx.account_name);
    return Array.from(map, ([id, name]) => ({ id, name })).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }, [transactions]);

  const assignableCategories = useMemo(
    () => categories.filter((c) => c.kind === "expense" || c.kind === "income"),
    [categories]
  );

  const transferCount = useMemo(
    () => transactions.filter((t) => t.category_kind === "transfer").length,
    [transactions]
  );

  const filtered = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const min = minAmount.trim() === "" ? null : Number(minAmount);
    const max = maxAmount.trim() === "" ? null : Number(maxAmount);

    return transactions.filter((tx) => {
      if (!showTransfers && tx.category_kind === "transfer") return false;
      if (selectedAccount !== "all" && tx.account_id !== selectedAccount) return false;
      if (selectedCategory !== "all" && String(tx.category_id) !== selectedCategory) return false;
      if (query && !tx.description.toLowerCase().includes(query)) return false;

      const abs = Math.abs(tx.amount);
      if (min !== null && Number.isFinite(min) && abs < min) return false;
      if (max !== null && Number.isFinite(max) && abs > max) return false;

      return true;
    });
  }, [
    transactions,
    showTransfers,
    selectedAccount,
    selectedCategory,
    searchQuery,
    minAmount,
    maxAmount,
  ]);

  const { income, expenses, net } = useMemo(() => {
    let income = 0;
    let expenses = 0;
    for (const tx of filtered) {
      if (tx.amount > 0) income += tx.amount;
      else expenses += Math.abs(tx.amount);
    }
    const r = (n: number) => Math.round(n * 100) / 100;
    return { income: r(income), expenses: r(expenses), net: r(income - expenses) };
  }, [filtered]);

  const openEditor = (tx: TransactionRow) => {
    // Count siblings sharing this merchant key (including any in other months).
    setEditing({ tx, similarCount: 0 });
    fetch(`/api/similar-count?key=${encodeURIComponent(tx.merchant_key)}`)
      .then((r) => (r.ok ? r.json() : { count: 0 }))
      .then((d: { count?: number }) =>
        setEditing((cur) =>
          cur && cur.tx.id === tx.id ? { ...cur, similarCount: d.count ?? 0 } : cur
        )
      )
      .catch(() => {});
  };

  const submitAssignment = (categoryId: number, applyToSimilar: boolean) => {
    if (!editing) return;
    const fd = new FormData();
    fd.set("transactionId", editing.tx.id);
    fd.set("categoryId", String(categoryId));
    fd.set("applyToSimilar", applyToSimilar ? "true" : "false");

    startTransition(async () => {
      const res = await assignCategory(fd);
      setToast(res.message);
      setEditing(null);
      router.refresh();
      setTimeout(() => setToast(null), 3500);
    });
  };

  const submitNewCategory = (name: string, applyToSimilar: boolean) => {
    if (!editing) return;
    const fd = new FormData();
    fd.set("name", name);

    startTransition(async () => {
      const res = await createCategory(fd);
      if (!res.ok) {
        setToast(res.message);
        return;
      }
      // Look up the new category, then assign it.
      const list = (await fetch("/api/categories").then((r) => r.json())) as Category[];
      const created = list.find((c) => c.name.toLowerCase() === name.trim().toLowerCase());
      if (created) {
        const fd2 = new FormData();
        fd2.set("transactionId", editing.tx.id);
        fd2.set("categoryId", String(created.id));
        fd2.set("applyToSimilar", applyToSimilar ? "true" : "false");
        const res2 = await assignCategory(fd2);
        setToast(res2.message);
      } else {
        setToast(`Created "${name}".`);
      }
      setEditing(null);
      router.refresh();
      setTimeout(() => setToast(null), 3500);
    });
  };

  return (
    <>
      <h1 className="mb-2 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        {formatMonthLong(month)}
      </h1>
      <p className="mb-6 text-zinc-600 dark:text-zinc-400">
        {filtered.length} transaction{filtered.length !== 1 ? "s" : ""}
        {showTransfers ? "" : ` · ${transferCount} transfers hidden`}
      </p>

      <div className="mb-8 grid grid-cols-3 gap-4">
        <SummaryCard label="Income" value={income} tone="emerald" />
        <SummaryCard label="Expenses" value={expenses} tone="rose" />
        <SummaryCard label="Net" value={net} tone={net >= 0 ? "emerald" : "rose"} />
      </div>

      {categoryTotals.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-2">
          {categoryTotals.map((c) => (
            <button
              key={c.category_id}
              onClick={() =>
                setSelectedCategory((cur) =>
                  cur === String(c.category_id) ? "all" : String(c.category_id)
                )
              }
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                selectedCategory === String(c.category_id)
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                  : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
              }`}
            >
              {c.category_name}
              <span className="ml-2 opacity-70">{formatCurrency(c.total)}</span>
            </button>
          ))}
        </div>
      )}

      <div className="mb-6 space-y-4 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search description..."
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          />
          <label className="flex shrink-0 items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
            <input
              type="checkbox"
              checked={showTransfers}
              onChange={(e) => setShowTransfers(e.target.checked)}
              className="h-4 w-4 rounded border-zinc-300"
            />
            Show transfers
          </label>
        </div>

        <div className="flex flex-wrap gap-2">
          <FilterChip label="All accounts" active={selectedAccount === "all"} onClick={() => setSelectedAccount("all")} />
          {accounts.map((a) => (
            <FilterChip
              key={a.id}
              label={a.name}
              active={selectedAccount === a.id}
              onClick={() => setSelectedAccount(a.id)}
            />
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-zinc-500 dark:text-zinc-400">Amount:</span>
          <input
            type="number"
            value={minAmount}
            onChange={(e) => setMinAmount(e.target.value)}
            placeholder="Min"
            className="w-24 rounded-lg border border-zinc-300 px-3 py-2 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          />
          <span className="text-zinc-400">to</span>
          <input
            type="number"
            value={maxAmount}
            onChange={(e) => setMaxAmount(e.target.value)}
            placeholder="Max"
            className="w-24 rounded-lg border border-zinc-300 px-3 py-2 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          />
          <button
            onClick={() => {
              setMinAmount("");
              setMaxAmount("");
            }}
            className="text-sm text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
          >
            Clear
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <table className="w-full text-sm">
          <thead className="bg-zinc-100 text-left text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
            <tr>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Account</th>
              <th className="px-4 py-3">Description</th>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
            {filtered.map((tx) => (
              <tr
                key={tx.id}
                className={`hover:bg-zinc-50 dark:hover:bg-zinc-900/50 ${
                  tx.category_kind === "transfer" ? "opacity-60" : ""
                }`}
              >
                <td className="whitespace-nowrap px-4 py-3 text-zinc-600 dark:text-zinc-400">
                  {formatEpoch(tx.posted_at)}
                </td>
                <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{tx.account_name}</td>
                <td className="px-4 py-3 text-zinc-900 dark:text-zinc-100">
                  {tx.description}
                  {tx.pending ? (
                    <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                      pending
                    </span>
                  ) : null}
                  {tx.category_kind === "transfer" && (
                    <span className="ml-2 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                      transfer
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => openEditor(tx)}
                    className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
                  >
                    {tx.category_name}
                  </button>
                </td>
                <td
                  className={`whitespace-nowrap px-4 py-3 text-right font-medium ${
                    tx.amount >= 0
                      ? "text-emerald-700 dark:text-emerald-400"
                      : "text-rose-700 dark:text-rose-400"
                  }`}
                >
                  {formatCurrency(tx.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="px-4 py-12 text-center text-sm text-zinc-500 dark:text-zinc-400">
            No transactions match the current filters.
          </div>
        )}
      </div>

      {editing && (
        <CategoryEditor
          tx={editing.tx}
          categories={assignableCategories}
          similarCount={editing.similarCount}
          busy={isPending}
          onCancel={() => setEditing(null)}
          onAssign={submitAssignment}
          onCreate={submitNewCategory}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white shadow-lg dark:bg-zinc-100 dark:text-zinc-900">
          {toast}
        </div>
      )}
    </>
  );
}

function CategoryEditor({
  tx,
  categories,
  similarCount,
  busy,
  onCancel,
  onAssign,
  onCreate,
}: {
  tx: TransactionRow;
  categories: Category[];
  similarCount: number;
  busy: boolean;
  onCancel: () => void;
  onAssign: (categoryId: number, applyToSimilar: boolean) => void;
  onCreate: (name: string, applyToSimilar: boolean) => void;
}) {
  const [applyToSimilar, setApplyToSimilar] = useState(similarCount > 1);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Set category
        </h2>
        <p className="mt-1 truncate text-xs text-zinc-500 dark:text-zinc-400" title={tx.description}>
          {tx.description} · {formatCurrency(tx.amount)}
        </p>

        <div className="mt-4 grid grid-cols-2 gap-2">
          {categories.map((c) => (
            <button
              key={c.id}
              disabled={busy}
              onClick={() => onAssign(c.id, applyToSimilar)}
              className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors disabled:opacity-50 ${
                c.id === tx.category_id
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                  : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>

        <label
          className={`mt-4 flex items-start gap-2 text-sm ${
            similarCount > 1 ? "text-zinc-700 dark:text-zinc-300" : "opacity-60"
          }`}
        >
          <input
            type="checkbox"
            checked={applyToSimilar}
            disabled={similarCount <= 1}
            onChange={(e) => setApplyToSimilar(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-zinc-300"
          />
          <span>
            Apply to similar transactions
            <span className="block text-xs text-zinc-500 dark:text-zinc-400">
              {similarCount > 1
                ? `Matches merchant ${tx.merchant_key} — ${similarCount} transactions`
                : "No other transactions share this merchant"}
            </span>
          </span>
        </label>

        <div className="mt-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          {creating ? (
            <div className="flex gap-2">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="New category name"
                className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newName.trim()) {
                    onCreate(newName.trim(), applyToSimilar);
                  }
                }}
              />
              <button
                disabled={busy || !newName.trim()}
                onClick={() => onCreate(newName.trim(), applyToSimilar)}
                className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
              >
                Add
              </button>
            </div>
          ) : (
            <button
              onClick={() => setCreating(true)}
              className="text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
            >
              + New category
            </button>
          )}
        </div>

        <div className="mt-5 flex justify-end">
          <button
            onClick={onCancel}
            className="rounded-lg px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
        active
          ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
          : "border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
      }`}
    >
      {label}
    </button>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "emerald" | "rose";
}) {
  const colorClass =
    tone === "emerald"
      ? "text-emerald-700 dark:text-emerald-400"
      : "text-rose-700 dark:text-rose-400";

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{label}</p>
      <p className={`text-xl font-semibold ${colorClass}`}>{formatCurrency(value)}</p>
    </div>
  );
}
