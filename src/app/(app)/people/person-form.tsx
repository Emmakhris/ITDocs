"use client";

import { ActionForm, Field, Submit } from "@/components/form";
import { Input, LinkButton, Select } from "@/components/ui";
import type { ActionState } from "@/server/lib/forms";

export function PersonForm({
  action,
  values = {},
  departments,
  cancelHref,
}: {
  action: (p: ActionState, fd: FormData) => Promise<ActionState>;
  values?: Record<string, string | boolean | null | undefined>;
  departments: { id: string; name: string }[];
  cancelHref: string;
}) {
  const v = (k: string) => (values[k] as string | null | undefined) ?? "";
  return (
    <ActionForm action={action} className="max-w-2xl space-y-4 rounded-lg border border-line bg-surface p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" name="name" required><Input id="name" name="name" defaultValue={v("name")} /></Field>
        <Field label="Email" name="email"><Input id="email" name="email" type="email" defaultValue={v("email")} /></Field>
        <Field label="Employee ID" name="employeeId"><Input id="employeeId" name="employeeId" defaultValue={v("employeeId")} /></Field>
        <Field label="Phone / extension" name="phone"><Input id="phone" name="phone" defaultValue={v("phone")} /></Field>
        <Field label="Job title" name="title"><Input id="title" name="title" defaultValue={v("title")} /></Field>
        <Field label="Department" name="departmentId">
          <Select id="departmentId" name="departmentId" defaultValue={v("departmentId")}>
            <option value="">—</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </Select>
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={values.active !== false} className="h-4 w-4" /> Active (left the organisation → untick)
        </label>
      </div>
      <div className="flex gap-2">
        <Submit>Save</Submit>
        <LinkButton href={cancelHref}>Cancel</LinkButton>
      </div>
    </ActionForm>
  );
}
