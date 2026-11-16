import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { listCategories, monthCategoryTotals, monthTransactions } from "@/lib/data";
import { formatMonthLong } from "@/lib/format";
import TransactionList from "./TransactionList";

async function MonthContent({ month }: { month: string }) {
  await connection();

  const transactions = monthTransactions(month);
  const categories = listCategories();
  const totals = monthCategoryTotals(month);

  return (
    <TransactionList
      transactions={transactions}
      categories={categories}
      categoryTotals={totals}
      month={month}
    />
  );
}

export default function MonthPage({ params }: PageProps<"/[month]">) {
  return (
    <div className="px-6 py-12">
      <div className="mx-auto max-w-5xl">
        <Link
          href="/"
          className="mb-4 inline-block text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          ← Back to cash flow
        </Link>
        <Suspense
          fallback={
            <div className="h-96 animate-pulse rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950" />
          }
        >
          {params.then(({ month }) => (
            <MonthContent month={month} />
          ))}
        </Suspense>
      </div>
    </div>
  );
}
