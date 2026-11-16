import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { CircleAlertIcon, LandmarkIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  computeMonthlyCashFlow,
  countTransactions,
  latestSync,
  pendingSummary,
} from "@/lib/data";
import { formatCurrency, formatMonth } from "@/lib/format";
import { cn } from "@/lib/utils";

async function CashFlow() {
  // Sync SQLite reads are "predictable", so opt into per-request rendering.
  await connection();

  const transactions = countTransactions();
  const monthly = computeMonthlyCashFlow();
  const pending = pendingSummary();
  const sync = latestSync();

  const totalIncome = monthly.reduce((sum, m) => sum + m.income, 0);
  const totalExpenses = monthly.reduce((sum, m) => sum + m.expenses, 0);
  const totalNet = totalIncome - totalExpenses;

  if (transactions === 0) {
    return (
      <Empty className="border border-dashed bg-card">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <LandmarkIcon />
          </EmptyMedia>
          <EmptyTitle>No transactions yet</EmptyTitle>
          <EmptyDescription>
            Run{" "}
            <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs">
              npm run sync
            </code>{" "}
            to fetch from SimpleFIN. Responses are cached to{" "}
            <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs">
              data/simplefin/
            </code>{" "}
            first, so parsing errors never cost a request.
          </EmptyDescription>
        </EmptyHeader>
        {sync?.error && (
          <Alert variant="destructive" className="max-w-xl text-left">
            <CircleAlertIcon />
            <AlertTitle>Last sync failed</AlertTitle>
            <AlertDescription className="font-mono text-xs">
              {sync.error}
            </AlertDescription>
          </Alert>
        )}
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm text-muted-foreground">
            {transactions.toLocaleString()} transactions across {monthly.length}{" "}
            months
          </p>
          {pending.count > 0 && (
            <Badge variant="secondary">{pending.count} pending</Badge>
          )}
        </div>
        {sync && (
          <p className="text-xs text-muted-foreground">
            Last synced{" "}
            {new Date(sync.started_at * 1000).toLocaleString("en-US", {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </p>
        )}
      </div>

      <Card className="gap-0 py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Month</TableHead>
              <TableHead className="text-right">Money in</TableHead>
              <TableHead className="text-right">Money out</TableHead>
              <TableHead className="text-right">Net cash flow</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {monthly.map((m) => (
              <TableRow key={m.month}>
                <TableCell>
                  <Link
                    href={`/${m.month}`}
                    className="font-medium text-primary underline-offset-4 hover:underline"
                  >
                    {formatMonth(m.month)}
                  </Link>
                </TableCell>
                <TableCell className="text-right tabular-nums text-success">
                  {formatCurrency(m.income)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-destructive">
                  {formatCurrency(m.expenses)}
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right font-medium tabular-nums",
                    m.net >= 0 ? "text-success" : "text-destructive"
                  )}
                >
                  {formatCurrency(m.net)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell>Total</TableCell>
              <TableCell className="text-right tabular-nums text-success">
                {formatCurrency(totalIncome)}
              </TableCell>
              <TableCell className="text-right tabular-nums text-destructive">
                {formatCurrency(totalExpenses)}
              </TableCell>
              <TableCell
                className={cn(
                  "text-right tabular-nums",
                  totalNet >= 0 ? "text-success" : "text-destructive"
                )}
              >
                {formatCurrency(totalNet)}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </Card>
    </div>
  );
}

function CashFlowSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-56" />
        <Skeleton className="h-3 w-36" />
      </div>
      <Skeleton className="h-96 rounded-4xl" />
    </div>
  );
}

export default function Home() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-12">
      <h1 className="font-heading text-3xl font-semibold tracking-tight">
        Monthly Cash Flow
      </h1>
      <Suspense fallback={<CashFlowSkeleton />}>
        <CashFlow />
      </Suspense>
    </div>
  );
}
