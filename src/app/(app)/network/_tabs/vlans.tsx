import Link from "next/link";
import { listVlans } from "@/server/modules/network";
import { locationTree } from "@/server/modules/locations";
import { ActionForm, ConfirmSubmit, Field, Submit } from "@/components/form";
import { LocationSelect } from "@/components/pickers";
import { Card, Empty, Input, LinkButton, Table, Textarea } from "@/components/ui";
import { deleteVlanAction, saveVlanAction } from "../actions";
import type { TabProps } from "./shared";

export async function VlansTab({ ctx, sp, writable }: TabProps) {
  const [rows, locations] = await Promise.all([listVlans(ctx), sp.edit ? locationTree() : []]);
  const editing = sp.edit && writable ? (sp.edit === "new" ? null : rows.find((r) => r.id === sp.edit)) : undefined;

  return (
    <div className="space-y-4">
      {writable && !sp.edit && (
        <div className="text-right"><LinkButton href="/network?tab=vlans&edit=new" variant="primary">New VLAN</LinkButton></div>
      )}

      {editing !== undefined && (
        <Card title={editing ? `Edit VLAN ${editing.number}` : "New VLAN"}>
          <ActionForm key={editing?.id ?? "new"} action={saveVlanAction.bind(null, editing?.id ?? null)} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="VLAN ID" name="number" required hint="1–4094"><Input id="number" name="number" type="number" min={1} max={4094} defaultValue={editing?.number} /></Field>
              <Field label="Name" name="name" required><Input id="name" name="name" defaultValue={editing?.name} /></Field>
              <Field label="Site" name="locationId" className="lg:col-span-2" hint="The same VLAN ID can be reused at different sites">
                <LocationSelect id="locationId" name="locationId" locations={locations} defaultValue={editing?.locationId} emptyLabel="— All sites —" />
              </Field>
              <Field label="Purpose" name="purpose" className="sm:col-span-2 lg:col-span-4"><Input id="purpose" name="purpose" defaultValue={editing?.purpose ?? ""} placeholder="e.g. Biomed devices — isolated, no internet" /></Field>
              <Field label="Notes" name="notes" className="sm:col-span-2 lg:col-span-4"><Textarea id="notes" name="notes" defaultValue={editing?.notes ?? ""} className="min-h-16" /></Field>
            </div>
            <div className="flex gap-2">
              <Submit>Save VLAN</Submit>
              <LinkButton href="/network?tab=vlans">Cancel</LinkButton>
            </div>
          </ActionForm>
          {editing && (
            <ActionForm action={deleteVlanAction.bind(null, editing.id)} className="mt-4 border-t border-line pt-4 text-right">
              <ConfirmSubmit message={`Delete VLAN ${editing.number}? Subnets, ports and Wi-Fi networks using it will show no VLAN.`}>Delete VLAN</ConfirmSubmit>
            </ActionForm>
          )}
        </Card>
      )}

      {rows.length === 0 ? (
        <Empty title="No VLANs yet">Document VLAN IDs and what they&apos;re for, then link subnets, switch ports and Wi-Fi to them.</Empty>
      ) : (
        <Table>
          <thead>
            <tr><th>ID</th><th>Name</th><th>Site</th><th>Purpose</th><th>Subnets</th><th>Ports</th><th>Wi-Fi</th>{writable && <th />}</tr>
          </thead>
          <tbody>
            {rows.map((v) => (
              <tr key={v.id}>
                <td className="font-mono font-medium">{v.number}</td>
                <td>{v.name}</td>
                <td>{v.location?.name ?? <span className="text-muted">All sites</span>}</td>
                <td className="max-w-md text-muted">{v.purpose}</td>
                <td>{v._count.subnets}</td>
                <td>{v._count.switchPorts}</td>
                <td>{v._count.wifiNetworks}</td>
                {writable && <td className="text-right"><Link href={`/network?tab=vlans&edit=${v.id}`} className="text-xs text-brand hover:underline">Edit</Link></td>}
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
