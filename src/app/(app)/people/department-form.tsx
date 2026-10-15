"use client";

import { ActionForm, Submit } from "@/components/form";
import { Input } from "@/components/ui";
import { addDepartmentAction } from "./actions";

export function DepartmentForm() {
  return (
    <ActionForm action={addDepartmentAction} resetOnSuccess className="space-y-2">
      <Input name="name" placeholder="New department name" aria-label="Department name" />
      <Input name="costCenter" placeholder="Cost centre (optional)" aria-label="Cost centre" />
      <Submit variant="secondary">Add department</Submit>
    </ActionForm>
  );
}
