import Link from "next/link";
import { listSubnets, vlanOptions } from "@/server/modules/network";
import { locationTree } from "@/server/modules/locations";
import { ActionForm, ConfirmSubmit, Field, Submit } from "@/components/form";
import { LocationSelect } from "@/components/pickers";
import { Button, Card, Empty, Input, LinkButton, Table, Textarea } from "@/components/ui";
import { deleteSubnetAction, saveSubnetAction } from "../actions";
import { UsageBar, VlanSelect, type TabProps } from "./shared";

export async function SubnetsTab({ ctx, sp, writable }: TabProps) {
  const [rows, vlans, locations] = await Promise.all([listSubnets(ctx, { q: sp.q }), vlanOptions(), sp.edit ? locationTree() : []]);
  const editing = sp.edit && writable ? (sp.edit === "new" ? null : rows.find((r) => r.id === sp.edit)) : undefined;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <form className="flex gap-2">
          <input type="hidden" name="tab" value="subnets" />
          <Input name="q" defaultValue={sp.q} placeholder="Filter by name or network…" className="w-64" aria-label="Filter subnets" />
          <Button variant="secondary">Filter</Button>
        </form>
        {writable && !sp.edit && <LinkButton href="/network?tab=subnets&edit=new" variant="primary">New subnet</LinkButton>}
      </div>

      {editing !== undefined && (
        <Card title={editing ? `Edit ${editing.cidr}` : "New subnet"}>
          <ActionForm key={editing?.id ?? "new"} action={saveSubnetAction.bind(null, editing?.id ?? null)} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Network (CIDR)" name="cidr" required hint="e.g. 10.20.0.0/24">
                <Input id="cidr" name="cidr" defaultValue={editing?.cidr} className="font-mono" placeholder="10.20.0.0/24" />
              </Field>
              <Field label="Name" name="name" required><Input id="name" name="name" defaultValue={editing?.name} /></Field>
              <Field label="VLAN" name="vlanId"><VlanSelect name="vlanId" options={vlans} defaultValue={editing?.vlanId} /></Field>
              <Field label="Site" name="locationId">
                <LocationSelect id="locationId" name="locationId" locations={locations} defaultValue={editing?.locationId} emptyLabel="— Any site —" />
              </Field>
              <Field label="Gateway" name="gateway"><Input id="gateway" name="gateway" defaultValue={editing?.gateway ?? ""} className="font-mono" /></Field>
              <Field label="DNS servers" name="dns" hint="Comma-separated"><Input id="dns" name="dns" defaultValue={editing?.dns ?? ""} className="font-mono" /></Field>
              <Field label="DHCP range start" name="dhcpStart"><Input id="dhcpStart" name="dhcpStart" defaultValue={editing?.dhcpStart ?? ""} className="font-mono" /></Field>
              <Field label="DHCP range end" name="dhcpEnd"><Input id="dhcpEnd" name="dhcpEnd" defaultValue={editing?.dhcpEnd ?? ""} className="font-mono" /></Field>
              <Field label="Notes" name="notes" className="sm:col-span-2 lg:col-span-3"><Textarea id="notes" name="notes" defaultValue={editing?.notes ?? ""} className="min-h-16" /></Field>
            </div>
            <div className="flex gap-2">
              <Submit>Save subnet</Submit>
              <LinkButton href={editing ? `/network/subnets/${editing.id}` : "/network?tab=subnets"}>Cancel</LinkButton>
            </div>
          </ActionForm>
          {editing && (
            <ActionForm action={deleteSubnetAction.bind(null, editing.id)} className="mt-4 border-t border-line pt-4 text-right">
              <ConfirmSubmit message={`Delete ${editing.cidr} and its ${editing.usage.used} IP record(s)? The audit log keeps a copy.`}>Delete subnet</ConfirmSubmit>
            </ActionForm>
          )}
        </Card>
      )}

      {rows.length === 0 ? (
        <Empty title={sp.q ? "No matching subnets" : "No subnets yet"}>Add your networks to track which addresses are used and by what.</Empty>
      ) : (
        <Table>
          <thead>
            <tr><th>Network</th><th>Name</th><th>VLAN</th><th>Site</th><th>Gateway</th><th>DHCP pool</th><th>Used</th></tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id}>
                <td><Link href={`/network/subnets/${s.id}`} className="font-mono font-medium text-brand hover:underline">{s.cidr}</Link></td>
                <td>{s.name}</td>
                <td>{s.vlan ? `${s.vlan.number} · ${s.vlan.name}` : <span className="text-muted">—</span>}</td>
                <td>{s.location?.name ?? <span className="text-muted">—</span>}</td>
                <td className="font-mono text-xs">{s.gateway ?? "—"}</td>
                <td className="font-mono text-xs">{s.dhcpStart ? `${s.dhcpStart} – ${s.dhcpEnd}` : "—"}</td>
                <td><UsageBar used={s.usage.used} total={s.usage.total} /></td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
