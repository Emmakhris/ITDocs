import { ActionForm, Field, Submit } from "@/components/form";
import { Input, LinkButton, Select, Textarea, toDateInput } from "@/components/ui";
import type { ActionState } from "@/server/lib/forms";
import { LICENSE_MODEL, SEAT_BASIS } from "./labels";

type Action = (p: ActionState, fd: FormData) => Promise<ActionState>;
type Opt = { id: string; name: string };
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

export function SoftwareForm({ action, values = {}, vendors, cancelHref }: { action: Action; values?: Record<string, unknown>; vendors: Opt[]; cancelHref: string }) {
  return (
    <ActionForm action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Name" name="name" required className="sm:col-span-2"><Input id="name" name="name" defaultValue={str(values.name)} placeholder="e.g. Microsoft 365 E3" /></Field>
        <Field label="Publisher / vendor" name="vendorId">
          <Select id="vendorId" name="vendorId" defaultValue={str(values.vendorId)}>
            <option value="">— None —</option>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </Select>
        </Field>
        <Field label="Category" name="category"><Input id="category" name="category" defaultValue={str(values.category)} placeholder="Clinical, Productivity…" /></Field>
        <Field label="Website" name="website" className="sm:col-span-2"><Input id="website" name="website" defaultValue={str(values.website)} placeholder="https://" /></Field>
        <Field label="Notes" name="notes" className="sm:col-span-2 lg:col-span-4"><Textarea id="notes" name="notes" defaultValue={str(values.notes)} className="min-h-16" /></Field>
      </div>
      <div className="flex gap-2"><Submit>Save software</Submit><LinkButton href={cancelHref}>Cancel</LinkButton></div>
    </ActionForm>
  );
}

export function LicenseForm({
  action,
  values = {},
  software,
  vendors,
  contracts,
  cancelHref,
  editing,
}: {
  action: Action;
  values?: Record<string, unknown>;
  software: Opt[];
  vendors: Opt[];
  contracts: { id: string; title: string }[];
  cancelHref: string;
  editing: boolean;
}) {
  return (
    <ActionForm action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Software" name="softwareId" required>
          <Select id="softwareId" name="softwareId" defaultValue={str(values.softwareId)}>
            <option value="">— Choose —</option>
            {software.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        <Field label="Licence name" name="name" required className="sm:col-span-2"><Input id="name" name="name" defaultValue={str(values.name)} placeholder="e.g. 2026 enterprise agreement" /></Field>
        <Field label="Type" name="model">
          <Select id="model" name="model" defaultValue={str(values.model) || "SUBSCRIPTION"}>
            {Object.entries(LICENSE_MODEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        <Field label="Licensed per" name="seatBasis">
          <Select id="seatBasis" name="seatBasis" defaultValue={str(values.seatBasis) || "USER"}>
            {Object.entries(SEAT_BASIS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        <Field label="Seats" name="seats" hint="Leave empty for a site licence"><Input id="seats" name="seats" type="number" min={1} defaultValue={str(values.seats)} /></Field>
        <Field label="Expires / renews" name="expiresAt"><Input id="expiresAt" name="expiresAt" type="date" defaultValue={toDateInput(values.expiresAt as Date | null)} /></Field>
        <Field label="Purchased" name="purchaseDate"><Input id="purchaseDate" name="purchaseDate" type="date" defaultValue={toDateInput(values.purchaseDate as Date | null)} /></Field>
        <Field label="Licence key" name="licenseKey" className="sm:col-span-2" hint={editing ? (values.hasKey ? "A key is stored. Leave empty to keep it." : "No key stored.") : "Encrypted with the vault master key"}>
          <Input id="licenseKey" name="licenseKey" autoComplete="off" spellCheck={false} className="font-mono" placeholder={editing && values.hasKey ? "•••••••• (unchanged)" : ""} />
        </Field>
        {editing && !!values.hasKey && (
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input type="checkbox" name="clearKey" className="h-4 w-4 accent-brand" /> Remove stored key
          </label>
        )}
        <Field label="Bought from" name="vendorId">
          <Select id="vendorId" name="vendorId" defaultValue={str(values.vendorId)}>
            <option value="">— None —</option>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </Select>
        </Field>
        <Field label="Contract" name="contractId">
          <Select id="contractId" name="contractId" defaultValue={str(values.contractId)}>
            <option value="">— None —</option>
            {contracts.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </Select>
        </Field>
        <Field label="PO number" name="poNumber"><Input id="poNumber" name="poNumber" defaultValue={str(values.poNumber)} /></Field>
        <Field label="Cost" name="cost"><Input id="cost" name="cost" type="number" step="0.01" min={0} defaultValue={str(values.cost)} /></Field>
        <Field label="Notes" name="notes" className="sm:col-span-2 lg:col-span-4"><Textarea id="notes" name="notes" defaultValue={str(values.notes)} className="min-h-16" /></Field>
      </div>
      <div className="flex gap-2"><Submit>Save licence</Submit><LinkButton href={cancelHref}>Cancel</LinkButton></div>
    </ActionForm>
  );
}
