"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDownIcon, SearchIcon, XIcon } from "lucide-react";
import { assignCategory } from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { Category, MonthCategoryTotal, TransactionRow } from "@/lib/types";
import { formatCurrency, formatEpoch, formatMonthLong } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Props {
  transactions: TransactionRow[];
  categories: Category[];
  categoryTotals: MonthCategoryTotal[];
  /** transaction id -> flow tag, computed server-side with the same rules as the home page. */
  flowTags: Record<string, string>;
  month: string;
}

export default function TransactionList({
  transactions,
  categories,
  categoryTotals,
  flowTags,
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

  const accounts = useMemo(() => {
    const map = new Map<string, string>();
    for (const tx of transactions) map.set(tx.account_id, tx.account_name);
    return Array.from(map, ([id, name]) => ({ id, name })).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }, [transactions]);

  const isInternalFlow = useCallback(
    (tx: TransactionRow) => {
      const tag = flowTags[tx.id];
      if (!tag) return false;
      return (
        tag === "card-payment" ||
        tag === "savings-sweep" ||
        tag === "own-transfer" ||
        tag === "investment"
      );
    },
    [flowTags]
  );

  const transferCount = useMemo(
    () => transactions.filter(isInternalFlow).length,
    [transactions, isInternalFlow]
  );

  const filtered = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const min = minAmount.trim() === "" ? null : Number(minAmount);
    const max = maxAmount.trim() === "" ? null : Number(maxAmount);

    return transactions.filter((tx) => {
      if (!showTransfers && isInternalFlow(tx)) return false;
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
    isInternalFlow,
    selectedAccount,
    selectedCategory,
    searchQuery,
    minAmount,
    maxAmount,
  ]);

  const summary = useMemo(() => {
    // Use the server's flow classification so the month view agrees with the
    // home page: transfers and card payments are not income or spending.
    let income = 0;
    let expenses = 0;
    let internal = 0;
    for (const tx of filtered) {
      const tag = flowTags[tx.id];
      const isInternal = tag
        ? tag === "card-payment" ||
          tag === "savings-sweep" ||
          tag === "own-transfer" ||
          tag === "investment"
        : false;
      if (isInternal) {
        internal += tx.amount;
        continue;
      }
      if (tx.amount > 0) income += tx.amount;
      else expenses += Math.abs(tx.amount);
    }
    const r = (n: number) => Math.round(n * 100) / 100;
    return {
      income: r(income),
      expenses: r(expenses),
      net: r(income - expenses),
      internal: r(internal),
    };
  }, [filtered, flowTags]);
  const { income, expenses, net, internal } = summary;

  const hasFilters =
    showTransfers ||
    selectedAccount !== "all" ||
    selectedCategory !== "all" ||
    searchQuery.trim() !== "" ||
    minAmount !== "" ||
    maxAmount !== "";

  const clearFilters = () => {
    setShowTransfers(false);
    setSelectedAccount("all");
    setSelectedCategory("all");
    setSearchQuery("");
    setMinAmount("");
    setMaxAmount("");
  };

  const submitAssignment = (txId: string, categoryId: number) => {
    const fd = new FormData();
    fd.set("transactionId", txId);
    fd.set("categoryId", String(categoryId));

    startTransition(async () => {
      const res = await assignCategory(fd);
      toast.add({
        type: res.ok ? "success" : "error",
        title: res.ok ? "Category updated" : "Could not update category",
        description: res.message,
      });
      if (res.ok) router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h1 className="font-heading text-3xl font-semibold tracking-tight">
            {formatMonthLong(month)}
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>
              {filtered.length} transaction{filtered.length !== 1 ? "s" : ""}
            </span>
            {!showTransfers && transferCount > 0 && (
              <Badge variant="outline">{transferCount} transfers hidden</Badge>
            )}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <SummaryCard label="Money in" value={income} tone="positive" />
          <SummaryCard label="Money out" value={expenses} tone="negative" />
          <SummaryCard
            label="Net cash flow"
            value={net}
            tone={net >= 0 ? "positive" : "negative"}
          />
        </div>

        {internal !== 0 && (
          <p className="text-xs text-muted-foreground">
            Excludes {formatCurrency(Math.abs(internal))} of transfers between your own
            accounts (card payments, savings sweeps). Turn on &ldquo;Show
            transfers&rdquo; to see them.
          </p>
        )}

        {categoryTotals.length > 0 && (
          <Field>
            <FieldTitle id="category-filter-label">Categories</FieldTitle>
            <ToggleGroup
              aria-labelledby="category-filter-label"
              variant="outline"
              size="sm"
              spacing={2}
              className="flex-wrap"
              value={selectedCategory === "all" ? [] : [selectedCategory]}
              onValueChange={(value) => setSelectedCategory(value[0] ?? "all")}
            >
              {categoryTotals.map((c) => (
                <ToggleGroupItem key={c.category_id} value={String(c.category_id)}>
                  {c.category_name}
                  <span className="text-muted-foreground tabular-nums">
                    {formatCurrency(c.total)}
                  </span>
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>
        )}

        <Card size="sm">
          <CardHeader>
            <CardTitle>Filters</CardTitle>
            <CardDescription>
              Search and narrow down this month&rsquo;s transactions.
            </CardDescription>
            {hasFilters && (
              <CardAction>
                <Button variant="ghost" size="sm" onClick={clearFilters}>
                  <XIcon data-icon="inline-start" />
                  Clear
                </Button>
              </CardAction>
            )}
          </CardHeader>
          <CardContent>
            <FieldGroup className="gap-5">
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <Field>
                  <FieldLabel htmlFor="tx-search">Search</FieldLabel>
                  <InputGroup>
                    <InputGroupAddon>
                      <SearchIcon />
                    </InputGroupAddon>
                    <InputGroupInput
                      id="tx-search"
                      type="search"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search description..."
                    />
                  </InputGroup>
                </Field>
                <Field orientation="horizontal" className="sm:pb-2">
                  <Switch
                    id="show-transfers"
                    checked={showTransfers}
                    onCheckedChange={setShowTransfers}
                  />
                  <FieldLabel htmlFor="show-transfers" className="font-normal">
                    Show transfers
                  </FieldLabel>
                </Field>
              </div>

              <Field>
                <FieldTitle id="account-filter-label">Account</FieldTitle>
                <ToggleGroup
                  aria-labelledby="account-filter-label"
                  variant="outline"
                  size="sm"
                  spacing={2}
                  className="flex-wrap"
                  value={[selectedAccount]}
                  onValueChange={(value) => setSelectedAccount(value[0] ?? "all")}
                >
                  <ToggleGroupItem value="all">All accounts</ToggleGroupItem>
                  {accounts.map((a) => (
                    <ToggleGroupItem key={a.id} value={a.id}>
                      {a.name}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </Field>

              <Field orientation="horizontal">
                <FieldLabel htmlFor="min-amount">Amount</FieldLabel>
                <Input
                  id="min-amount"
                  type="number"
                  inputMode="decimal"
                  value={minAmount}
                  onChange={(e) => setMinAmount(e.target.value)}
                  placeholder="Min"
                  className="w-24"
                />
                <span className="text-muted-foreground">to</span>
                <Input
                  id="max-amount"
                  type="number"
                  inputMode="decimal"
                  value={maxAmount}
                  onChange={(e) => setMaxAmount(e.target.value)}
                  placeholder="Max"
                  aria-label="Maximum amount"
                  className="w-24"
                />
              </Field>
            </FieldGroup>
          </CardContent>
        </Card>

        <Card className="gap-0 py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((tx) => (
                <TableRow
                  key={tx.id}
                  className={cn(isInternalFlow(tx) && "opacity-60")}
                >
                  <TableCell className="text-muted-foreground">
                    {formatEpoch(tx.posted_at)}
                  </TableCell>
                  <TableCell className="whitespace-normal text-muted-foreground">
                    {tx.account_name}
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <span className="font-medium">{tx.description}</span>
                    {tx.pending ? (
                      <Badge variant="secondary" className="ml-2">
                        pending
                      </Badge>
                    ) : null}
                    {isInternalFlow(tx) && (
                      <Badge variant="outline" className="ml-2">
                        transfer
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="outline"
                            size="xs"
                            disabled={isPending}
                            aria-label={`Change category for ${tx.description}`}
                          />
                        }
                      >
                        {tx.category_name}
                        <ChevronDownIcon data-icon="inline-end" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="min-w-44">
                        <DropdownMenuRadioGroup
                          value={String(tx.category_id)}
                          onValueChange={(value) =>
                            submitAssignment(tx.id, Number(value))
                          }
                        >
                          {categories.map((c) => (
                            <DropdownMenuRadioItem key={c.id} value={String(c.id)}>
                              {c.name}
                            </DropdownMenuRadioItem>
                          ))}
                        </DropdownMenuRadioGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right font-medium tabular-nums",
                      tx.amount >= 0 ? "text-success" : "text-destructive"
                    )}
                  >
                    {formatCurrency(tx.amount)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {filtered.length === 0 && (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <SearchIcon />
                </EmptyMedia>
                <EmptyTitle>
                  {transactions.length === 0
                    ? "No transactions this month"
                    : "No matching transactions"}
                </EmptyTitle>
                <EmptyDescription>
                  {transactions.length === 0
                    ? "Transactions will appear here after the next sync."
                    : "Try clearing filters or showing transfers."}
                </EmptyDescription>
              </EmptyHeader>
              {hasFilters && (
                <EmptyContent>
                  <Button variant="outline" size="sm" onClick={clearFilters}>
                    Clear filters
                  </Button>
                </EmptyContent>
              )}
            </Empty>
          )}
        </Card>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "positive" | "negative";
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle
          className={cn(
            "text-2xl tabular-nums",
            tone === "positive" ? "text-success" : "text-destructive"
          )}
        >
          {formatCurrency(value)}
        </CardTitle>
      </CardHeader>
    </Card>
  );
}
