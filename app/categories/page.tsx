import { Suspense } from "react";
import { connection } from "next/server";
import { Skeleton } from "@/components/ui/skeleton";
import { listCategories } from "@/lib/data";
import CategoryManager from "./CategoryManager";

async function CategoriesContent() {
  await connection();
  return <CategoryManager categories={listCategories()} />;
}

function CategoriesSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-28 rounded-4xl" />
      <Skeleton className="h-64 rounded-4xl" />
    </div>
  );
}

export default function CategoriesPage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-12">
      <div className="flex flex-col gap-2">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">
          Categories
        </h1>
        <p className="text-muted-foreground">
          Add the categories the sync assistant can choose from. New
          transactions are categorized automatically, with Other as the
          fallback.
        </p>
      </div>
      <Suspense fallback={<CategoriesSkeleton />}>
        <CategoriesContent />
      </Suspense>
    </div>
  );
}
