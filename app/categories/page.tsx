import { Suspense } from "react";
import { connection } from "next/server";
import { listCategories } from "@/lib/data";
import CategoryManager from "./CategoryManager";

async function CategoriesContent() {
  await connection();
  return <CategoryManager categories={listCategories()} />;
}

export default function CategoriesPage() {
  return (
    <div className="px-6 py-12">
      <div className="mx-auto max-w-2xl">
        <h1 className="mb-2 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Categories
        </h1>
        <p className="mb-8 text-zinc-600 dark:text-zinc-400">
          Everything starts in Other. Assign a category from any transaction, with the option to
          apply it to all similar transactions.
        </p>
        <Suspense
          fallback={
            <div className="h-64 animate-pulse rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950" />
          }
        >
          <CategoriesContent />
        </Suspense>
      </div>
    </div>
  );
}
