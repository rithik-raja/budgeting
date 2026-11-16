import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { ArrowLeftIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  listCategories,
  monthCategoryTotals,
  monthFlowTags,
  monthTransactions,
} from "@/lib/data";
import TransactionList from "./TransactionList";

async function MonthContent({ month }: { month: string }) {
  await connection();

  const transactions = monthTransactions(month);
  const categories = listCategories();
  const totals = monthCategoryTotals(month);
  const flowTags = monthFlowTags(month);

  return (
    <TransactionList
      transactions={transactions}
      categories={categories}
      categoryTotals={totals}
      flowTags={flowTags}
      month={month}
    />
  );
}

function MonthSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-4 w-48" />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Skeleton className="h-28 rounded-4xl" />
        <Skeleton className="h-28 rounded-4xl" />
        <Skeleton className="h-28 rounded-4xl" />
      </div>
      <Skeleton className="h-52 rounded-4xl" />
      <Skeleton className="h-96 rounded-4xl" />
    </div>
  );
}

export default function MonthPage({ params }: PageProps<"/[month]">) {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-12">
      <Button
        variant="ghost"
        size="sm"
        className="w-fit"
        render={<Link href="/" />}
        nativeButton={false}
      >
        <ArrowLeftIcon data-icon="inline-start" />
        Back to cash flow
      </Button>
      <Suspense fallback={<MonthSkeleton />}>
        {params.then(({ month }) => (
          <MonthContent month={month} />
        ))}
      </Suspense>
    </div>
  );
}
