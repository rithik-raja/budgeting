import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import {
  computeMonthlyCashFlow,
  countTransactions,
  latestSync,
  summaryCounts,
} from "@/lib/data";
import { formatCurrency, formatMonth } from "@/lib/format";

async function CashFlow() {
  // Sync SQLite reads are "predictable", so opt into per-request rendering.
  await connection();

  const transactions = countTransactions();
  const monthly = computeMonthlyCashFlow();
  const { months } = summaryCounts();
  const sync = latestSync();

  const totalIncome = monthly.reduce((sum, m) => sum + m.income, 0);
  const totalExpenses = monthly.reduce((sum, m) => sum + m.expenses, 0);
  const totalNet = totalIncome - totalExpenses;

  if (transactions === 0) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-8 text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <p className="font-medium text-zinc-900 dark:text-zinc-100">No transactions yet.</p>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          Run <code className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-xs dark:bg-zinc-900">npm run sync</code>{" "}
          to fetch from SimpleFIN. Responses are cached to{" "}
          <code className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-xs dark:bg-zinc-900">
            data/simplefin/
          </code>{" "}
          first, so parsing errors never cost a request.
        </p>
        {sync?.error && (
          <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 font-mono text-xs text-rose-800 dark:bg-rose-950/40 dark:text-rose-300">
            {sync.error}
          </p>
        )}
      </div>
    );
  }

  return (
    <>
      <p className="mb-8 text-zinc-600 dark:text-zinc-400">
        {transactions.toLocaleString()} transactions across {months} months
        {sync && (
          <span className="text-zinc-400 dark:text-zinc-500">
            {" "}
            · last synced{" "}
            {new Date(sync.started_at * 1000).toLocaleString("en-US", {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </span>
        )}
      </p>

      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <table className="w-full text-sm">
          <thead className="bg-zinc-100 text-left text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
            <tr>
              <th className="px-4 py-3">Month</th>
              <th className="px-4 py-3 text-right">Income</th>
              <th className="px-4 py-3 text-right">Expenses</th>
              <th className="px-4 py-3 text-right">Net</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
            {monthly.map((m) => (
              <tr key={m.month} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
                <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-100">
                  <Link
                    href={`/${m.month}`}
                    className="text-blue-600 hover:underline dark:text-blue-400"
                  >
                    {formatMonth(m.month)}
                  </Link>
                </td>
                <td className="px-4 py-3 text-right text-emerald-700 dark:text-emerald-400">
                  {formatCurrency(m.income)}
                </td>
                <td className="px-4 py-3 text-right text-rose-700 dark:text-rose-400">
                  {formatCurrency(m.expenses)}
                </td>
                <td
                  className={`px-4 py-3 text-right font-medium ${
                    m.net >= 0
                      ? "text-emerald-700 dark:text-emerald-400"
                      : "text-rose-700 dark:text-rose-400"
                  }`}
                >
                  {formatCurrency(m.net)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-zinc-100 font-semibold text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100">
            <tr>
              <td className="px-4 py-3">Total</td>
              <td className="px-4 py-3 text-right text-emerald-700 dark:text-emerald-400">
                {formatCurrency(totalIncome)}
              </td>
              <td className="px-4 py-3 text-right text-rose-700 dark:text-rose-400">
                {formatCurrency(totalExpenses)}
              </td>
              <td
                className={`px-4 py-3 text-right ${
                  totalNet >= 0
                    ? "text-emerald-700 dark:text-emerald-400"
                    : "text-rose-700 dark:text-rose-400"
                }`}
              >
                {formatCurrency(totalNet)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="mt-6 text-xs text-zinc-500 dark:text-zinc-500">
        Transfers and credit card payments are excluded from cash flow to avoid double counting.
      </p>
    </>
  );
}

function CashFlowSkeleton() {
  return (
    <div className="h-64 animate-pulse rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950" />
  );
}

export default function Home() {
  return (
    <div className="px-6 py-12">
      <div className="mx-auto max-w-3xl">
        <h1 className="mb-2 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Monthly Cash Flow
        </h1>
        <Suspense fallback={<CashFlowSkeleton />}>
          <CashFlow />
        </Suspense>
      </div>
    </div>
  );
}
