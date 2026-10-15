"use client";

import { ActionForm, Field, Submit } from "@/components/form";
import { Input, LinkButton, Select, Textarea } from "@/components/ui";
import { LocationSelect, type LocationOpt } from "@/components/pickers";
import type { ActionState } from "@/server/lib/forms";

export const LOCATION_TYPES = ["SITE", "BUILDING", "FLOOR", "ROOM", "AREA", "RACK", "STORAGE"] as const;

export function LocationForm({
  action,
  values = {},
  locations,
  cancelHref,
}: {
  action: (p: ActionState, fd: FormData) => Promise<ActionState>;
  values?: Record<string, string | null | undefined>;
  locations: LocationOpt[];
  cancelHref: string;
}) {
  return (
    <ActionForm action={action} className="max-w-2xl space-y-4 rounded-lg border border-line bg-surface p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" name="name" required><Input id="name" name="name" defaultValue={values.name ?? ""} /></Field>
        <Field label="Type" name="type" required>
          <Select id="type" name="type" defaultValue={values.type ?? "ROOM"}>
            {LOCATION_TYPES.map((t) => (
              <option key={t} value={t}>{t.charAt(0) + t.slice(1).toLowerCase()}</option>
            ))}
          </Select>
        </Field>
        <Field label="Parent" name="parentId">
          <LocationSelect id="parentId" name="parentId" locations={locations.filter((l) => l.id !== values.id)} defaultValue={values.parentId} emptyLabel="— Top level —" />
        </Field>
        <Field label="Short code" name="code" hint="Optional, unique — useful for imports and labels"><Input id="code" name="code" defaultValue={values.code ?? ""} /></Field>
        <Field label="Address" name="address" className="sm:col-span-2"><Input id="address" name="address" defaultValue={values.address ?? ""} /></Field>
        <Field label="Notes" name="notes" className="sm:col-span-2" hint="Access instructions, contacts, door codes location (not the codes themselves)…">
          <Textarea id="notes" name="notes" defaultValue={values.notes ?? ""} />
        </Field>
      </div>
      <div className="flex gap-2">
        <Submit>Save location</Submit>
        <LinkButton href={cancelHref}>Cancel</LinkButton>
      </div>
    </ActionForm>
  );
}
