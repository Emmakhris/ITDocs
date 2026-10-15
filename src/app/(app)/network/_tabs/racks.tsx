import Link from "next/link";
import { listRacks } from "@/server/modules/network";
import { locationTree } from "@/server/modules/locations";
import { ActionForm, ConfirmSubmit, Field, Submit } from "@/components/form";
import { LocationSelect } from "@/components/pickers";
import { Card, Empty, Input, LinkButton, Table, Textarea } from "@/components/ui";
import { deleteRackAction, saveRackAction } from "../actions";
import { UsageBar, type TabProps } from "./shared";

export async function RacksTab({ ctx, sp, writable }: TabProps) {
  const [rows, locations] = await Promise.all([listRacks(ctx), sp.edit ? locationTree() : []]);
  const editing = sp.edit && writable ? (sp.edit === "new" ? null : rows.find((r) => r.id === sp.edit)) : undefined;

  return (
    <div className="space-y-4">
      {writable && !sp.edit && (
        <div className="text-right"><LinkButton href="/network?tab=racks&edit=new" variant="primary">New rack</LinkButton></div>
      )}

      {editing !== undefined && (
        <Card title={editing ? `Edit ${editing.name}` : "New rack"}>
          <ActionForm key={editing?.id ?? "new"} action={saveRackAction.bind(null, editing?.id ?? null)} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Name" name="name" required><Input id="name" name="name" defaultValue={editing?.name} placeholder="e.g. MDF-R01" /></Field>
              <Field label="Height (U)" name="heightU" required><Input id="heightU" name="heightU" type="number" min={1} max={60} defaultValue={editing?.heightU ?? 42} /></Field>
              <Field label="Location" name="locationId" className="lg:col-span-2">
                <LocationSelect id="locationId" name="locationId" locations={locations} defaultValue={editing?.locationId} />
              </Field>
              <Field label="Notes" name="notes" className="sm:col-span-2 lg:col-span-4"><Textarea id="notes" name="notes" defaultValue={editing?.notes ?? ""} className="min-h-16" /></Field>
            </div>
            <div className="flex gap-2">
              <Submit>Save rack</Submit>
              <LinkButton href={editing ? `/network/racks/${editing.id}` : "/network?tab=racks"}>Cancel</LinkButton>
            </div>
          </ActionForm>
          {editing && (
            <ActionForm action={deleteRackAction.bind(null, editing.id)} className="mt-4 border-t border-line pt-4 text-right">
              <ConfirmSubmit message={`Delete rack ${editing.name} and its ${editing.mountCount} placement(s)? The assets themselves are not deleted.`}>Delete rack</ConfirmSubmit>
            </ActionForm>
          )}
        </Card>
      )}

      {rows.length === 0 ? (
        <Empty title="No racks yet">Add comms-room racks to record which equipment sits in which rack unit.</Empty>
      ) : (
        <Table>
          <thead>
            <tr><th>Rack</th><th>Location</th><th>Height</th><th>Items</th><th>Units used</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td><Link href={`/network/racks/${r.id}`} className="font-medium text-brand hover:underline">{r.name}</Link></td>
                <td>{r.location ? <Link href={`/locations/${r.location.id}`} className="hover:underline">{r.location.name}</Link> : <span className="text-muted">—</span>}</td>
                <td>{r.heightU}U</td>
                <td>{r.mountCount}</td>
                <td><UsageBar used={r.usedU} total={r.heightU} /></td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
