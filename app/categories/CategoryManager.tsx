"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { createCategory, deleteCategory } from "@/app/actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import type { Category } from "@/lib/types";

const FALLBACK_CATEGORY = "Other";

export default function CategoryManager({ categories }: { categories: Category[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("");

  const onCreate = () => {
    if (!name.trim()) return;
    const fd = new FormData();
    fd.set("name", name.trim());
    startTransition(async () => {
      const res = await createCategory(fd);
      toast.add({
        type: res.ok ? "success" : "error",
        title: res.ok ? "Category created" : "Could not create category",
        description: res.message,
      });
      if (res.ok) setName("");
      router.refresh();
    });
  };

  const onDelete = (id: number) => {
    const fd = new FormData();
    fd.set("id", String(id));
    startTransition(async () => {
      const res = await deleteCategory(fd);
      toast.add({
        type: res.ok ? "success" : "error",
        title: res.ok ? "Category deleted" : "Could not delete category",
        description: res.message,
      });
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <Card size="sm">
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="new-category">New category</FieldLabel>
              <InputGroup>
                <InputGroupInput
                  id="new-category"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="New category name"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onCreate();
                  }}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    variant="secondary"
                    size="sm"
                    disabled={isPending || !name.trim()}
                    onClick={onCreate}
                  >
                    {isPending ? (
                      <Spinner data-icon="inline-start" />
                    ) : (
                      <PlusIcon data-icon="inline-start" />
                    )}
                    Add
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card size="sm" className="gap-0 py-0">
        <ul className="divide-y divide-border">
          {categories.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <span className="text-sm font-medium">{c.name}</span>
              {c.name !== FALLBACK_CATEGORY && (
                <AlertDialog>
                  <AlertDialogTrigger render={<Button variant="ghost" size="sm" />}>
                    <Trash2Icon data-icon="inline-start" />
                    Delete
                  </AlertDialogTrigger>
                  <AlertDialogContent size="sm">
                    <AlertDialogHeader>
                      <AlertDialogMedia className="bg-destructive/10 text-destructive">
                        <Trash2Icon />
                      </AlertDialogMedia>
                      <AlertDialogTitle>Delete {c.name}?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Its transactions move back to {FALLBACK_CATEGORY}. This cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel variant="ghost">Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        variant="destructive"
                        disabled={isPending}
                        onClick={() => onDelete(c.id)}
                      >
                        {isPending ? (
                          <Spinner data-icon="inline-start" />
                        ) : (
                          <Trash2Icon data-icon="inline-start" />
                        )}
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <p className="text-xs text-muted-foreground">
        Sync assigns new transactions to these categories. Deleting a category moves its
        transactions back to {FALLBACK_CATEGORY}; {FALLBACK_CATEGORY} cannot be deleted.
      </p>
    </div>
  );
}
