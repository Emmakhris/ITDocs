import Link from "next/link";
import { db } from "@/server/db";
import { getPort, listPorts, listSwitches, vlanOptions } from "@/server/modules/network";
import { ActionForm, ConfirmSubmit, Field, Submit } from "@/components/form";
import { RemotePicker } from "@/components/pickers";
import { Badge, Button, Card, Empty, Input, LinkButton, Select, Table, cx } from "@/components/ui";
import { bulkPortsAction, deletePortAction, savePortAction } from "../actions";
import { PORT_MODE, PORT_STATUS } from "../labels";
import { VlanSelect, type TabProps } from "./shared";

export async function PortsTab({ ctx, sp, writable }: TabProps) {
  const editId = writable && sp.edit && sp.edit !== "new" && sp.edit !== "bulk" ? sp.edit : null;
  const [switches, ports, vlans, editing] = await Promise.all([
    listSwitches(ctx),
    sp.switchId || sp.q ? listPorts(ctx, { switchId: sp.switchId, q: sp.q }) : [],
    vlanOptions(),
    editId ? getPort(ctx, editId) : null,
  ]);
  const switchId = editing?.switchId ?? sp.switchId;
  const current = switchId ? await db.asset.findUnique({ where: { id: switchId }, select: { id: true, tag: true, name: true } }) : null;
  const switchOpt = current ? { id: current.id, label: `${current.tag} · ${current.name}` } : null;
  const base = `/network?tab=ports${switchId ? `&switchId=${switchId}` : ""}`;
  const showForm = writable && (sp.edit === "new" || !!editing);

  return (
    <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
      <Card title="Switches">
        {switches.length ? (
          <ul className="space-y-0.5 text-sm">
            {switches.map((s) => (
              <li key={s.id}>
                <Link href={`/network?tab=ports&switchId=${s.id}`} className={cx("flex justify-between gap-2 rounded px-2 py-1 hover:bg-surface-2", s.id === switchId && "bg-brand-soft text-brand")}>
                  <span className="truncate">
                    <span className="font-mono">{s.tag}</span> <span className="text-muted">{s.hostname ?? s.name}</span>
                  </span>
                  <span className="text-xs text-muted">{s.ports}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No ports documented yet.</p>
        )}
        {writable && (
          <div className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
            <LinkButton size="sm" href={`${base}&edit=bulk`}>Add a range of ports</LinkButton>
            <LinkButton size="sm" href={`${base}&edit=new`}>Add one port</LinkButton>
          </div>
        )}
      </Card>

      <div className="min-w-0 space-y-4">
        <form className="grid gap-2 sm:grid-cols-[minmax(0,22rem)_auto]">
          <input type="hidden" name="tab" value="ports" />
          <Input name="q" defaultValue={sp.q} placeholder="Find by wall jack, patch port, device…" aria-label="Search ports" />
          <Button variant="secondary">Search</Button>
        </form>

        {writable && sp.edit === "bulk" && (
          <Card title="Add a range of ports">
            <ActionForm action={bulkPortsAction} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                <Field label="Switch" name="switchId" required className="sm:col-span-2"><RemotePicker name="switchId" kind="assets" initial={switchOpt} placeholder="Search assets…" /></Field>
                <Field label="Name prefix" name="prefix" required hint='"Gi1/0/" → Gi1/0/1…'><Input id="prefix" name="prefix" defaultValue="Gi1/0/" className="font-mono" /></Field>
                <Field label="From" name="from" required><Input id="from" name="from" type="number" defaultValue={1} /></Field>
                <Field label="To" name="to" required><Input id="to" name="to" type="number" defaultValue={48} /></Field>
                <Field label="Access VLAN" name="vlanId" className="sm:col-span-2"><VlanSelect name="vlanId" options={vlans} /></Field>
              </div>
              <p className="text-xs text-muted">Ports that already exist are skipped.</p>
              <div className="flex gap-2"><Submit>Create ports</Submit><LinkButton href={base}>Cancel</LinkButton></div>
            </ActionForm>
          </Card>
        )}

        {showForm && (
          <Card title={editing ? `Edit ${editing.switch.tag} ${editing.name}` : "New port"}>
            <ActionForm key={editing?.id ?? "new"} action={savePortAction.bind(null, editing?.id ?? null)} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Switch" name="switchId" required><RemotePicker name="switchId" kind="assets" initial={switchOpt} placeholder="Search assets…" /></Field>
                <Field label="Port" name="name" required><Input id="name" name="name" defaultValue={editing?.name} className="font-mono" placeholder="Gi1/0/12" /></Field>
                <Field label="Status" name="status">
                  <Select id="status" name="status" defaultValue={editing?.status ?? "ACTIVE"}>
                    {Object.entries(PORT_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </Select>
                </Field>
                <Field label="Connected device" name="connectedAssetId">
                  <RemotePicker name="connectedAssetId" kind="assets" initial={editing?.connectedAsset ? { id: editing.connectedAsset.id, label: `${editing.connectedAsset.tag} · ${editing.connectedAsset.name}` } : null} />
                </Field>
                <Field label="Patch-panel port" name="patchPanelPort"><Input id="patchPanelPort" name="patchPanelPort" defaultValue={editing?.patchPanelPort ?? ""} placeholder="PP-A 12" /></Field>
                <Field label="Wall jack" name="wallJack"><Input id="wallJack" name="wallJack" defaultValue={editing?.wallJack ?? ""} placeholder="3F-301-02" /></Field>
                <Field label="Mode" name="mode">
                  <Select id="mode" name="mode" defaultValue={editing?.mode ?? "ACCESS"}>
                    {Object.entries(PORT_MODE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </Select>
                </Field>
                <Field label="VLAN (access / native)" name="vlanId"><VlanSelect name="vlanId" options={vlans} defaultValue={editing?.vlanId} /></Field>
                <Field label="Allowed VLANs (trunk)" name="allowedVlans" hint="e.g. 10,20,100-110"><Input id="allowedVlans" name="allowedVlans" defaultValue={editing?.allowedVlans ?? ""} className="font-mono" /></Field>
                <Field label="Description" name="description" className="sm:col-span-2 lg:col-span-3"><Input id="description" name="description" defaultValue={editing?.description ?? ""} /></Field>
              </div>
              <div className="flex gap-2"><Submit>Save port</Submit><LinkButton href={base}>Cancel</LinkButton></div>
            </ActionForm>
            {editing && (
              <ActionForm action={deletePortAction.bind(null, editing.switchId, editing.id)} className="mt-4 border-t border-line pt-4 text-right">
                <ConfirmSubmit message={`Delete port ${editing.name}?`}>Delete port</ConfirmSubmit>
              </ActionForm>
            )}
          </Card>
        )}

        {!switchId && !sp.q ? (
          <Empty title="Choose a switch">Pick a switch on the left, or search for a wall jack or device to trace its cable.</Empty>
        ) : ports.length === 0 ? (
          <Empty title="No ports found">{writable && current && <>Use <Link className="text-brand hover:underline" href={`${base}&edit=bulk`}>Add a range of ports</Link> to document {current.tag}.</>}</Empty>
        ) : (
          <Table>
            <thead>
              <tr>{(sp.q || !switchId) && <th>Switch</th>}<th>Port</th><th>Status</th><th>VLAN</th><th>Connected to</th><th>Patch panel</th><th>Wall jack</th><th>Description</th>{writable && <th />}</tr>
            </thead>
            <tbody>
              {ports.map((p) => (
                <tr key={p.id} className={p.id === editing?.id ? "bg-brand-soft/50" : undefined}>
                  {(sp.q || !switchId) && <td><Link className="font-mono text-brand hover:underline" href={`/assets/${p.switch.id}`}>{p.switch.tag}</Link></td>}
                  <td className="font-mono">{p.name}</td>
                  <td><Badge tone={PORT_STATUS[p.status].tone}>{PORT_STATUS[p.status].label}</Badge></td>
                  <td className="whitespace-nowrap">
                    {p.mode === "TRUNK" ? <><Badge tone="blue">Trunk</Badge> <span className="font-mono text-xs">{p.allowedVlans ?? "all"}</span></> : p.vlan ? `${p.vlan.number} · ${p.vlan.name}` : <span className="text-muted">—</span>}
                  </td>
                  <td>{p.connectedAsset ? <Link className="text-brand hover:underline" href={`/assets/${p.connectedAsset.id}`}>{p.connectedAsset.tag}</Link> : <span className="text-muted">—</span>}</td>
                  <td className="font-mono text-xs">{p.patchPanelPort}</td>
                  <td className="font-mono text-xs">{p.wallJack}</td>
                  <td className="text-muted">{p.description}</td>
                  {writable && <td className="text-right"><Link href={`/network?tab=ports&switchId=${p.switchId}&edit=${p.id}`} className="text-xs text-brand hover:underline">Edit</Link></td>}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
    </div>
  );
}
