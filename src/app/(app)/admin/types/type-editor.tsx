"use client";

import { useState } from "react";
import { Trash2, ArrowUp } from "lucide-react";
import { ActionForm, ConfirmSubmit, Field, Submit } from "@/components/form";
import { Button, Card, Input, LinkButton, Select } from "@/components/ui";
import type { FieldDef, FieldKind } from "@/server/lib/custom-fields";
import type { ActionState } from "@/server/lib/forms";

const KINDS: { v: FieldKind; label: string }[] = [
  { v: "text", label: "Text" },
  { v: "textarea", label: "Long text" },
  { v: "number", label: "Number" },
  { v: "date", label: "Date" },
  { v: "select", label: "Drop-down" },
  { v: "boolean", label: "Yes / No" },
  { v: "url", label: "Link (URL)" },
];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^(\d)/, "f_$1").slice(0, 40);

export function TypeEditor({
  action,
  deleteAction,
  values,
}: {
  action: (p: ActionState, fd: FormData) => Promise<ActionState>;
  deleteAction?: (p: ActionState) => Promise<ActionState>;
  values?: { name: string; icon: string | null; tagPrefix: string | null; isMedical: boolean; fieldDefs: FieldDef[] };
}) {
  const [defs, setDefs] = useState<FieldDef[]>(values?.fieldDefs ?? []);
  const set = (i: number, patch: Partial<FieldDef>) => setDefs((d) => d.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const isNew = (i: number) => i >= (values?.fieldDefs.length ?? 0);

  return (
    <div className="max-w-4xl space-y-4">
      <ActionForm action={action} className="space-y-4">
        <input type="hidden" name="fieldDefs" value={JSON.stringify(defs)} />
        <Card title="Type">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Name" name="name" required><Input id="name" name="name" defaultValue={values?.name} /></Field>
            <Field label="Tag prefix" name="tagPrefix" hint="Blank = organisation default"><Input id="tagPrefix" name="tagPrefix" defaultValue={values?.tagPrefix ?? ""} /></Field>
            <label className="flex items-center gap-2 pt-5 text-sm">
              <input type="checkbox" name="isMedical" defaultChecked={values?.isMedical} className="h-4 w-4" /> Medical device
            </label>
          </div>
        </Card>
        <Card title="Custom fields" actions={<Button type="button" size="sm" variant="secondary" onClick={() => setDefs((d) => [...d, { key: "", label: "", kind: "text", required: false }])}>Add field</Button>}>
          {defs.length === 0 && <p className="text-sm text-muted">No custom fields. Standard fields (serial, model, location…) are always available.</p>}
          <div className="space-y-3">
            {defs.map((d, i) => (
              <div key={i} className="grid items-end gap-2 rounded-md border border-line p-3 sm:grid-cols-[1fr_140px_150px_auto]">
                <Field label="Label" name={`fieldDefs.${i}.label`}>
                  <Input
                    value={d.label}
                    onChange={(e) => set(i, { label: e.target.value, ...(isNew(i) ? { key: slug(e.target.value) } : {}) })}
                    placeholder="e.g. Drug library version"
                  />
                </Field>
                <Field label="Key" name={`fieldDefs.${i}.key`} hint={isNew(i) ? undefined : "fixed"}>
                  <Input value={d.key} readOnly={!isNew(i)} onChange={(e) => set(i, { key: slug(e.target.value) })} className="font-mono text-xs" />
                </Field>
                <Field label="Kind" name={`fieldDefs.${i}.kind`}>
                  <Select value={d.kind} onChange={(e) => set(i, { kind: e.target.value as FieldKind })}>
                    {KINDS.map((k) => <option key={k.v} value={k.v}>{k.label}</option>)}
                  </Select>
                </Field>
                <div className="flex items-center gap-1 pb-1">
                  <label className="mr-2 flex items-center gap-1 text-xs">
                    <input type="checkbox" checked={d.required} onChange={(e) => set(i, { required: e.target.checked })} /> Required
                  </label>
                  <Button type="button" size="sm" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => setDefs((x) => { const n = [...x]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; return n; })}>
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button type="button" size="sm" variant="ghost" aria-label="Remove field" onClick={() => setDefs((x) => x.filter((_, j) => j !== i))}>
                    <Trash2 className="h-4 w-4 text-danger" />
                  </Button>
                </div>
                {d.kind === "select" && (
                  <Field label="Options (comma separated)" name={`fieldDefs.${i}.options`} className="sm:col-span-4">
                    <Input
                      defaultValue={d.options?.join(", ") ?? ""}
                      onChange={(e) => set(i, { options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
                    />
                  </Field>
                )}
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted">Removing a field hides it from forms; values already stored stay in the database and the audit log.</p>
        </Card>
        <div className="flex gap-2">
          <Submit>Save type</Submit>
          <LinkButton href="/admin/types">Cancel</LinkButton>
        </div>
      </ActionForm>
      {deleteAction && (
        <ActionForm action={deleteAction} className="text-right">
          <ConfirmSubmit message="Delete this asset type? Only types with no assets can be deleted.">Delete type</ConfirmSubmit>
        </ActionForm>
      )}
    </div>
  );
}
