import { ActionForm, Field, Submit } from "@/components/form";
import { RemotePicker } from "@/components/pickers";
import { Input, LinkButton, Select, Textarea, toDateInput } from "@/components/ui";
import type { ActionState } from "@/server/lib/forms";
import { CONTRACT_TYPE } from "./labels";

type Action = (p: ActionState, fd: FormData) => Promise<ActionState>;
type V = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

export function VendorForm({ action, values = {}, cancelHref }: { action: Action; values?: V; cancelHref: string }) {
  const text = (name: string, label: string, opts: { hint?: string; className?: string; type?: string; placeholder?: string } = {}) => (
    <Field label={label} name={name} hint={opts.hint} className={opts.className}>
      <Input id={name} name={name} type={opts.type} defaultValue={str(values[name])} placeholder={opts.placeholder} />
    </Field>
  );
  return (
    <ActionForm action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Name" name="name" required><Input id="name" name="name" defaultValue={str(values.name)} /></Field>
        {text("accountNumber", "Our account number")}
        {text("website", "Website", { placeholder: "https://" })}
        {text("phone", "Main phone")}
        {text("email", "Main email", { type: "email" })}
        <span className="hidden lg:block" />
        {text("supportPhone", "Support phone")}
        {text("supportEmail", "Support email", { type: "email" })}
        {text("supportUrl", "Support portal", { placeholder: "https://", hint: "Keep the login in the password vault" })}
        <Field label="Notes" name="notes" className="sm:col-span-2 lg:col-span-3"><Textarea id="notes" name="notes" defaultValue={str(values.notes)} className="min-h-16" /></Field>
      </div>
      <div className="flex gap-2"><Submit>Save vendor</Submit><LinkButton href={cancelHref}>Cancel</LinkButton></div>
    </ActionForm>
  );
}

export function ContractForm({
  action,
  values = {},
  vendors,
  cancelHref,
  credential,
  vaultUser,
}: {
  action: Action;
  values?: Record<string, unknown>;
  vendors: { id: string; name: string }[];
  cancelHref: string;
  credential?: { id: string; title: string } | null;
  vaultUser: boolean;
}) {
  const s = (k: string) => (values[k] === null || values[k] === undefined ? "" : String(values[k]));
  return (
    <ActionForm action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Title" name="title" required className="sm:col-span-2"><Input id="title" name="title" defaultValue={s("title")} placeholder="e.g. PACS 24×7 support" /></Field>
        <Field label="Vendor" name="vendorId" required>
          <Select id="vendorId" name="vendorId" defaultValue={s("vendorId")}>
            <option value="">— Choose —</option>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </Select>
        </Field>
        <Field label="Type" name="type">
          <Select id="type" name="type" defaultValue={s("type") || "SUPPORT"}>
            {Object.entries(CONTRACT_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        <Field label="Contract / agreement number" name="reference"><Input id="reference" name="reference" defaultValue={s("reference")} /></Field>
        <Field label="Start date" name="startDate"><Input id="startDate" name="startDate" type="date" defaultValue={toDateInput(values.startDate as Date | null)} /></Field>
        <Field label="End date" name="endDate"><Input id="endDate" name="endDate" type="date" defaultValue={toDateInput(values.endDate as Date | null)} /></Field>
        <Field label="Notice period (days)" name="noticeDays" hint="Days before the end date to cancel or renegotiate"><Input id="noticeDays" name="noticeDays" type="number" min={0} max={730} defaultValue={s("noticeDays")} /></Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input type="checkbox" name="autoRenew" defaultChecked={!!values.autoRenew} className="h-4 w-4 accent-brand" /> Renews automatically
        </label>
        <Field label="Annual cost" name="annualCost"><Input id="annualCost" name="annualCost" type="number" step="0.01" min={0} defaultValue={s("annualCost")} /></Field>
        <Field label="SLA / coverage" name="sla" className="sm:col-span-2"><Input id="sla" name="sla" defaultValue={s("sla")} placeholder="e.g. 4h response 24×7, next-business-day parts" /></Field>
        <Field label="Internal owner" name="ownerName"><Input id="ownerName" name="ownerName" defaultValue={s("ownerName")} /></Field>
        {vaultUser && (
          <Field label="Support-portal login (vault)" name="credentialId" className="sm:col-span-2">
            <RemotePicker name="credentialId" kind="credentials" initial={credential ? { id: credential.id, label: credential.title } : null} placeholder="Search vault credentials…" />
          </Field>
        )}
        <Field label="Notes" name="notes" className="sm:col-span-2 lg:col-span-4"><Textarea id="notes" name="notes" defaultValue={s("notes")} className="min-h-16" /></Field>
      </div>
      <div className="flex gap-2"><Submit>Save contract</Submit><LinkButton href={cancelHref}>Cancel</LinkButton></div>
    </ActionForm>
  );
}
