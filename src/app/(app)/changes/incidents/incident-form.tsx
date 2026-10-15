import { ActionForm, Field, Submit } from "@/components/form";
import { Input, LinkButton, Select, Textarea } from "@/components/ui";
import type { ActionState } from "@/server/lib/forms";
import { changeNo } from "@/server/lib/workflow";
import { SEVERITY, toDateTimeInput } from "../shared";

type Values = {
  title?: string;
  description?: string;
  severity?: string;
  impact?: string | null;
  startedAt?: Date | null;
  ownerId?: string | null;
  causedByChangeId?: string | null;
  ticketRef?: string | null;
  rootCause?: string | null;
  resolution?: string | null;
  followUp?: string | null;
};

export function IncidentForm({
  action,
  values = {},
  owners,
  changes,
  cancelHref,
  editing,
}: {
  action: (p: ActionState, fd: FormData) => Promise<ActionState>;
  values?: Values;
  owners: { id: string; displayName: string }[];
  changes: { id: string; number: number; title: string }[];
  cancelHref: string;
  editing: boolean;
}) {
  return (
    <ActionForm action={action} className="space-y-4">
      <div className="grid gap-4 rounded-lg border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="What's wrong" name="title" required className="sm:col-span-2 lg:col-span-4"><Input id="title" name="title" defaultValue={values.title} placeholder="e.g. EHR very slow on all wards" /></Field>
        <Field label="Severity" name="severity" hint={SEVERITY[(values.severity as keyof typeof SEVERITY) ?? "P3"]?.hint}>
          <Select id="severity" name="severity" defaultValue={values.severity ?? "P3"}>
            {Object.entries(SEVERITY).map(([k, v]) => <option key={k} value={k}>{k} — {v.hint.split(" — ")[0]}</option>)}
          </Select>
        </Field>
        <Field label="Started" name="startedAt" hint="Leave empty for now"><Input id="startedAt" name="startedAt" type="datetime-local" defaultValue={toDateTimeInput(values.startedAt)} /></Field>
        <Field label="Owner" name="ownerId">
          <Select id="ownerId" name="ownerId" defaultValue={values.ownerId ?? ""}>
            <option value="">{editing ? "— Nobody —" : "— Me —"}</option>
            {owners.map((o) => <option key={o.id} value={o.id}>{o.displayName}</option>)}
          </Select>
        </Field>
        <Field label="Ticket #" name="ticketRef"><Input id="ticketRef" name="ticketRef" defaultValue={values.ticketRef ?? ""} /></Field>
        <Field label="Impact" name="impact" className="sm:col-span-2" hint="Who is affected and how"><Input id="impact" name="impact" defaultValue={values.impact ?? ""} /></Field>
        <Field label="Caused by change" name="causedByChangeId" className="sm:col-span-2">
          <Select id="causedByChangeId" name="causedByChangeId" defaultValue={values.causedByChangeId ?? ""}>
            <option value="">— Not known / none —</option>
            {changes.map((c) => <option key={c.id} value={c.id}>{changeNo(c.number)} {c.title}</option>)}
          </Select>
        </Field>
        <Field label="Details" name="description" className="sm:col-span-2 lg:col-span-4" hint="Markdown"><Textarea id="description" name="description" defaultValue={values.description} className="min-h-24 font-mono text-sm" /></Field>
      </div>
      {editing && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Field label="Resolution" name="resolution" hint="Needed before it can be marked resolved"><Textarea id="resolution" name="resolution" defaultValue={values.resolution ?? ""} className="min-h-28" /></Field>
          <Field label="Root cause" name="rootCause" hint="Needed to close a P1 or P2"><Textarea id="rootCause" name="rootCause" defaultValue={values.rootCause ?? ""} className="min-h-28" /></Field>
          <Field label="Follow-up actions / lessons" name="followUp"><Textarea id="followUp" name="followUp" defaultValue={values.followUp ?? ""} className="min-h-28" /></Field>
        </div>
      )}
      <div className="flex gap-2"><Submit>{editing ? "Save incident" : "Open incident"}</Submit><LinkButton href={cancelHref}>Cancel</LinkButton></div>
    </ActionForm>
  );
}
