"use client";

import { X } from "lucide-react";
import type { Role } from "@prisma/client";
import { ActionForm, Field, Submit } from "@/components/form";
import { Input, Select } from "@/components/ui";
import { createLocalUserAction, deleteMappingAction, saveMappingAction, updateUserAction } from "../actions";

const ROLES: [Role, string][] = [
  ["ADMIN", "Administrator"],
  ["TECHNICIAN", "Technician"],
  ["READONLY", "Read-only"],
  ["AUDITOR", "Auditor"],
];

export function UserRow({ id, role, active, self }: { id: string; role: Role; active: boolean; self: boolean }) {
  return (
    <ActionForm action={updateUserAction.bind(null, id)} className="flex items-center gap-2 [&>div[role]]:hidden">
      <Select name="role" defaultValue={role} disabled={self} className="h-8 w-36" aria-label="Role">
        {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </Select>
      <label className="flex items-center gap-1 text-xs">
        <input type="checkbox" name="active" defaultChecked={active} disabled={self} /> Active
      </label>
      {!self && <Submit variant="secondary">Save</Submit>}
    </ActionForm>
  );
}

export function MappingForm() {
  return (
    <ActionForm action={saveMappingAction} resetOnSuccess className="grid grid-cols-[1fr_120px] gap-2">
      <Field label="AD group" name="groupName"><Input id="groupName" name="groupName" placeholder="IT-Technicians" /></Field>
      <Field label="Role" name="role">
        <Select id="role" name="role" defaultValue="TECHNICIAN">
          {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
      </Field>
      <Field label="Priority" name="priority"><Input id="priority" name="priority" type="number" defaultValue="10" /></Field>
      <div className="flex items-end"><Submit variant="secondary">Add / update</Submit></div>
    </ActionForm>
  );
}

export function MappingDelete({ id }: { id: string }) {
  return (
    <ActionForm action={deleteMappingAction.bind(null, id)}>
      <button type="submit" className="text-muted hover:text-danger" aria-label="Remove mapping" onClick={(e) => { if (!confirm("Remove this mapping?")) e.preventDefault(); }}>
        <X className="h-4 w-4" />
      </button>
    </ActionForm>
  );
}

export function BreakGlassForm() {
  return (
    <ActionForm action={createLocalUserAction} resetOnSuccess className="space-y-2">
      <Field label="Username" name="username"><Input id="bg-username" name="username" autoComplete="off" /></Field>
      <Field label="Display name" name="displayName"><Input id="bg-displayName" name="displayName" /></Field>
      <Field label="Password" name="password" hint="14+ characters, upper, lower and digits"><Input id="bg-password" name="password" type="password" autoComplete="new-password" /></Field>
      <Submit variant="secondary">Create break-glass admin</Submit>
    </ActionForm>
  );
}
