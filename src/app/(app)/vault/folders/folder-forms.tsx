"use client";

import { X } from "lucide-react";
import { ActionForm, ConfirmSubmit, Field, Submit } from "@/components/form";
import { Input, LinkButton, Select, Textarea } from "@/components/ui";
import type { ActionState } from "@/server/lib/forms";
import { addGrantAction, deleteFolderAction, removeGrantAction } from "../actions";

export function FolderForm({
  action,
  values = {},
  cancelHref,
}: {
  action: (p: ActionState, fd: FormData) => Promise<ActionState>;
  values?: { name?: string; description?: string | null; restricted?: boolean };
  cancelHref: string;
}) {
  return (
    <ActionForm action={action} className="max-w-2xl space-y-4 rounded-lg border border-line bg-surface p-4">
      <Field label="Name" name="name" required><Input id="name" name="name" defaultValue={values.name} placeholder="e.g. Network devices, Clinical systems, Domain admins" /></Field>
      <Field label="Description" name="description"><Textarea id="description" name="description" defaultValue={values.description ?? ""} rows={2} /></Field>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="restricted" defaultChecked={values.restricted} className="mt-0.5 h-4 w-4" />
        <span>
          <strong>Restricted</strong>
          <span className="block text-muted">Only administrators and the roles / users you grant can see this folder. Unrestricted folders are open to every technician.</span>
        </span>
      </label>
      <div className="flex gap-2">
        <Submit>Save folder</Submit>
        <LinkButton href={cancelHref}>Cancel</LinkButton>
      </div>
    </ActionForm>
  );
}

export function GrantForm({ folderId, users }: { folderId: string; users: { id: string; displayName: string }[] }) {
  return (
    <ActionForm action={addGrantAction.bind(null, folderId)} className="grid gap-2 sm:grid-cols-[1fr_120px_auto]">
      <Field label="Who" name="who">
        <Select id="who" name="who" defaultValue="">
          <option value="">Choose…</option>
          <optgroup label="Role">
            <option value="role:TECHNICIAN">All technicians</option>
          </optgroup>
          <optgroup label="User">
            {users.map((u) => (
              <option key={u.id} value={`user:${u.id}`}>{u.displayName}</option>
            ))}
          </optgroup>
        </Select>
      </Field>
      <Field label="Access" name="level">
        <Select id="level" name="level" defaultValue="VIEW">
          <option value="VIEW">View</option>
          <option value="EDIT">Edit</option>
        </Select>
      </Field>
      <div className="flex items-end"><Submit variant="secondary">Grant</Submit></div>
    </ActionForm>
  );
}

export function RevokeGrant({ grantId, folderId }: { grantId: string; folderId: string }) {
  return (
    <ActionForm action={removeGrantAction.bind(null, grantId, folderId)}>
      <button type="submit" className="text-muted hover:text-danger" aria-label="Revoke access">
        <X className="h-4 w-4" />
      </button>
    </ActionForm>
  );
}

export function DeleteFolder({ folderId }: { folderId: string }) {
  return (
    <ActionForm action={deleteFolderAction.bind(null, folderId)} className="text-right">
      <ConfirmSubmit message="Delete this folder? Only empty folders can be deleted.">Delete folder</ConfirmSubmit>
    </ActionForm>
  );
}
