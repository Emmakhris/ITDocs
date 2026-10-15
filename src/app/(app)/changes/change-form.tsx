import { ActionForm, Field, Submit } from "@/components/form";
import { Input, LinkButton, Select, Textarea } from "@/components/ui";
import type { ActionState } from "@/server/lib/forms";
import { CHANGE_TYPE, RISK, toDateTimeInput } from "./shared";

type Values = {
  title?: string;
  description?: string;
  type?: string;
  risk?: string;
  impact?: string | null;
  implementationPlan?: string;
  rollbackPlan?: string;
  testPlan?: string;
  plannedStart?: Date | null;
  plannedEnd?: Date | null;
  ticketRef?: string | null;
};

export function ChangeForm({ action, values = {}, cancelHref, submitted }: { action: (p: ActionState, fd: FormData) => Promise<ActionState>; values?: Values; cancelHref: string; submitted?: boolean }) {
  const md = "Markdown: steps, checklists, tables";
  return (
    <ActionForm action={action} className="space-y-4">
      {submitted && (
        <p className="rounded-md border border-warn/30 bg-warn-soft px-3 py-2 text-sm text-warn">This change is awaiting approval. Saving edits returns it to Draft so it can be reviewed again.</p>
      )}
      <div className="grid gap-4 rounded-lg border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Title" name="title" required className="sm:col-span-2 lg:col-span-4"><Input id="title" name="title" defaultValue={values.title} placeholder="e.g. Upgrade core switch firmware to 17.9" /></Field>
        <Field label="Type" name="type" hint="Standard changes are pre-approved routine work">
          <Select id="type" name="type" defaultValue={values.type ?? "NORMAL"}>
            {Object.entries(CHANGE_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        <Field label="Risk" name="risk" hint="High risk needs an administrator to approve">
          <Select id="risk" name="risk" defaultValue={values.risk ?? "MEDIUM"}>
            {Object.entries(RISK).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </Select>
        </Field>
        <Field label="Window starts" name="plannedStart"><Input id="plannedStart" name="plannedStart" type="datetime-local" defaultValue={toDateTimeInput(values.plannedStart)} /></Field>
        <Field label="Window ends" name="plannedEnd"><Input id="plannedEnd" name="plannedEnd" type="datetime-local" defaultValue={toDateTimeInput(values.plannedEnd)} /></Field>
        <Field label="Impact" name="impact" className="sm:col-span-2 lg:col-span-3" hint="Who notices, and expected downtime"><Input id="impact" name="impact" defaultValue={values.impact ?? ""} placeholder="e.g. Wired network in Tower A down for ~10 min" /></Field>
        <Field label="Ticket #" name="ticketRef"><Input id="ticketRef" name="ticketRef" defaultValue={values.ticketRef ?? ""} /></Field>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Field label="Why / description" name="description" hint={md}><Textarea id="description" name="description" defaultValue={values.description} className="min-h-32 font-mono text-sm" /></Field>
        <Field label="Implementation plan" name="implementationPlan" hint={md}><Textarea id="implementationPlan" name="implementationPlan" defaultValue={values.implementationPlan} className="min-h-32 font-mono text-sm" placeholder={"1. …\n2. …"} /></Field>
        <Field label="Rollback plan" name="rollbackPlan" hint="Required unless the change is Standard"><Textarea id="rollbackPlan" name="rollbackPlan" defaultValue={values.rollbackPlan} className="min-h-32 font-mono text-sm" /></Field>
        <Field label="How you'll test it" name="testPlan" hint={md}><Textarea id="testPlan" name="testPlan" defaultValue={values.testPlan} className="min-h-32 font-mono text-sm" /></Field>
      </div>
      <div className="flex gap-2"><Submit>Save change</Submit><LinkButton href={cancelHref}>Cancel</LinkButton></div>
    </ActionForm>
  );
}
