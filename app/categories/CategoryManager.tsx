"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCategory, deleteCategory } from "@/app/actions";
import type { Category } from "@/lib/types";

export default function CategoryManager({ categories }: { categories: Category[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const expenseLike = categories.filter(
    (c) => !c.is_system || c.name === "Groceries" || c.name === "Bills" || c.name === "Other"
  );
  const systemOther = categories.filter((c) => !expenseLike.includes(c));

  const onCreate = () => {
    if (!name.trim()) return;
    const fd = new FormData();
    fd.set("name", name.trim());
    startTransition(async () => {
      const res = await createCategory(fd);
      setMessage(res.message);
      if (res.ok) setName("");
      router.refresh();
      setTimeout(() => setMessage(null), 3500);
    });
  };

  const onDelete = (id: number) => {
    const fd = new FormData();
    fd.set("id", String(id));
    startTransition(async () => {
      const res = await deleteCategory(fd);
      setMessage(res.message);
      router.refresh();
      setTimeout(() => setMessage(null), 3500);
    });
  };

  return (
    <>
      <div className="mb-6 flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New category name"
          className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          onKeyDown={(e) => {
            if (e.key === "Enter") onCreate();
          }}
        />
        <button
          disabled={isPending || !name.trim()}
          onClick={onCreate}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          Add
        </button>
      </div>

      {message && (
        <div className="mb-4 rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
          {message}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-900">
          {expenseLike.map((c) => (
            <li key={c.id} className="flex items-center justify-between px-4 py-3 text-sm">
              <span className="font-medium text-zinc-900 dark:text-zinc-100">{c.name}</span>
              {c.is_system ? (
                <span className="text-xs text-zinc-400 dark:text-zinc-500">system</span>
              ) : (
                <button
                  disabled={isPending}
                  onClick={() => onDelete(c.id)}
                  className="text-xs text-rose-600 hover:underline disabled:opacity-50 dark:text-rose-400"
                >
                  Delete
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>

      <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-500">
        Deleting a category moves its transactions back to Other. System categories:{" "}
        {systemOther.map((c) => c.name).join(", ")}.
      </p>
    </>
  );
}
