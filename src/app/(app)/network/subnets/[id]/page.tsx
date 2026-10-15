import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCtx } from "@/server/auth/session";
import { can } from "@/server/rbac/permissions";
import { getSubnet, subnetGrid, type GridCell } from "@/server/modules/network";
import { formatIp, inSubnet, parseIp } from "@/server/lib/ip";
import { NotFoundError } from "@/server/lib/errors";
import { db } from "@/server/db";
import { ActionForm, ConfirmSubmit, Field, Submit } from "@/components/form";
import { RemotePicker } from "@/components/pickers";
import { Badge, Card, DL, Input, LinkButton, PageHeader, Select, Table, Textarea, cx } from "@/components/ui";
import { allocateIpAction, releaseIpAction, saveIpAction } from "../../actions";
import { IP_STATUS } from "../../labels";
import { UsageBar } from "../../_tabs/shared";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const s = await db.subnet.findUnique({ where: { id: (await params).id }, select: { cidr: true } });
  return { title: s?.cidr ?? "Subnet" };
}

const CELL: Record<GridCell["state"], { cls: string; label: string }> = {
  assigned: { cls: "bg-ok-soft text-ok border-ok/40", label: "Assigned" },
  reserved: { cls: "bg-warn-soft text-warn border-warn/40", label: "Reserved" },
  dhcp: { cls: "bg-brand-soft text-brand border-brand/40", label: "DHCP reservation" },
  gateway: { cls: "bg-brand text-brand-fg border-brand", label: "Gateway" },
  pool: { cls: "bg-surface-2 text-muted border-dashed border-line", label: "DHCP pool" },
  network: { cls: "bg-surface-2 text-muted/60 border-transparent", label: "Network / broadcast" },
  broadcast: { cls: "bg-surface-2 text-muted/60 border-transparent", label: "" },
  noted: { cls: "bg-surface text-fg border-fg/30", label: "Free (has note)" },
  free: { cls: "bg-surface text-muted border-line hover:border-brand hover:text-brand", label: "Free" },
};

export default async function SubnetPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ip?: string; block?: string }> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  const sp = await searchParams;
  const s = await getSubnet(ctx, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const writable = can(ctx.user.role, "network", "write");
  const selected = sp.ip && inSubnet(sp.ip, s.info) ? sp.ip : null;
  const block = selected ? Math.floor((parseIp(selected)! - s.info.network) / 256) : Number(sp.block) || 0;
  const grid = subnetGrid(s, block);
  const record = selected ? s.addresses.find((a) => a.address === selected) : undefined;
  const href = (q: string) => `/network/subnets/${s.id}?${q}`;

  return (
    <>
      <PageHeader
        crumbs={[{ href: "/network?tab=subnets", label: "Network" }]}
        title={<span className="flex flex-wrap items-center gap-2"><span className="font-mono">{s.cidr}</span><span className="font-normal text-muted">·</span>{s.name}</span>}
        subtitle={s.vlan ? `VLAN ${s.vlan.number} · ${s.vlan.name}` : "No VLAN"}
        actions={writable && <LinkButton href={`/network?tab=subnets&edit=${s.id}`}>Edit subnet</LinkButton>}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="min-w-0 space-y-4 lg:col-span-2">
          <Card title="Addresses" actions={<UsageBar used={s.usage.used} total={s.usage.total} />}>
            {grid.blocks > 1 && (
              <nav className="mb-3 flex flex-wrap gap-1" aria-label="Address blocks">
                {Array.from({ length: grid.blocks }, (_, i) => (
                  <Link key={i} href={href(`block=${i}`)} className={cx("rounded border px-2 py-0.5 font-mono text-xs", i === grid.block ? "border-brand bg-brand-soft text-brand" : "border-line hover:bg-surface-2")}>
                    {formatIp(s.info.network + i * 256).replace(/\.0$/, ".x")}
                  </Link>
                ))}
              </nav>
            )}
            <p className="mb-2 font-mono text-xs text-muted">{grid.from} – {grid.to}</p>
            <div className="grid grid-cols-8 gap-1 sm:grid-cols-16" role="list" aria-label="IP address grid">
              {grid.cells.map((c) => {
                const clickable = c.state !== "network" && c.state !== "broadcast";
                const title = [c.ip, CELL[c.state].label || "Broadcast", c.hostname].filter(Boolean).join(" · ");
                const cls = cx("flex h-8 items-center justify-center rounded border font-mono text-[11px]", CELL[c.state].cls, c.ip === selected && "ring-2 ring-fg ring-offset-1 ring-offset-surface");
                return clickable ? (
                  <Link key={c.ip} role="listitem" href={href(`ip=${c.ip}`)} title={title} aria-label={title} className={cls} scroll={false}>{c.last}</Link>
                ) : (
                  <span key={c.ip} role="listitem" title={title} className={cls}>{c.last}</span>
                );
              })}
            </div>
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
              {(["free", "assigned", "reserved", "dhcp", "pool", "gateway", "network"] as const).map((k) => (
                <li key={k} className="flex items-center gap-1.5"><span className={cx("inline-block h-3 w-3 rounded border", CELL[k].cls)} />{CELL[k].label}</li>
              ))}
            </ul>
          </Card>

          <Card title={`Records (${s.addresses.length})`}>
            {s.addresses.length ? (
              <Table className="border-0">
                <thead><tr><th>Address</th><th>Status</th><th>Hostname</th><th>Device</th><th>MAC</th><th>Notes</th></tr></thead>
                <tbody>
                  {s.addresses.map((a) => (
                    <tr key={a.id} className={a.address === selected ? "bg-brand-soft/50" : undefined}>
                      <td><Link href={href(`ip=${a.address}`)} className="font-mono text-brand hover:underline" scroll={false}>{a.address}</Link></td>
                      <td><Badge tone={IP_STATUS[a.status].tone}>{IP_STATUS[a.status].label}</Badge></td>
                      <td className="font-mono text-xs">{a.hostname}</td>
                      <td>{a.asset && <Link href={`/assets/${a.asset.id}`} className="text-brand hover:underline">{a.asset.tag}</Link>}</td>
                      <td className="font-mono text-xs">{a.macAddress}</td>
                      <td className="text-muted">{a.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <p className="text-sm text-muted">No addresses recorded yet. Click a free square or use “Allocate next free”.</p>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          {selected && (
            <Card title={<span className="font-mono">{selected}</span>} actions={<Link href={href(`block=${grid.block}`)} className="text-xs text-muted hover:text-fg" scroll={false}>Close</Link>}>
              {writable ? (
                <>
                  <IpForm key={selected} action={saveIpAction.bind(null, s.id, record?.id ?? null)} address={selected} record={record} submit={record ? "Save" : "Record address"} />
                  {record && (
                    <ActionForm action={releaseIpAction.bind(null, s.id, record.id)} className="mt-4 border-t border-line pt-4 text-right">
                      <ConfirmSubmit message={`Release ${selected}? The record is removed; the audit log keeps a copy.`}>Release address</ConfirmSubmit>
                    </ActionForm>
                  )}
                </>
              ) : record ? (
                <DL items={[["Status", IP_STATUS[record.status].label], ["Hostname", record.hostname], ["Device", record.asset && <Link className="text-brand hover:underline" href={`/assets/${record.asset.id}`}>{record.asset.tag} · {record.asset.name}</Link>], ["MAC", record.macAddress], ["Notes", record.notes]]} />
              ) : (
                <p className="text-sm text-muted">Not recorded — free.</p>
              )}
            </Card>
          )}

          {writable && !selected && (
            <Card title="Allocate next free">
              {s.nextFree ? (
                <>
                  <p className="mb-3 text-sm">Next free: <span className="font-mono font-medium">{s.nextFree}</span> <span className="text-xs text-muted">(skips gateway and DHCP pool)</span></p>
                  <IpForm action={allocateIpAction.bind(null, s.id)} submit="Allocate" staticOnly />
                </>
              ) : (
                <p className="text-sm text-muted">No free static addresses left in this subnet.</p>
              )}
            </Card>
          )}

          <Card title="Subnet">
            <DL
              items={[
                ["Mask", <span key="m" className="font-mono">{s.info.mask}</span>],
                ["Usable hosts", <span key="u" className="font-mono">{formatIp(s.info.firstHost)} – {formatIp(s.info.lastHost)}</span>],
                ["Gateway", s.gateway && <span className="font-mono">{s.gateway}</span>],
                ["DHCP pool", s.dhcpStart && <span className="font-mono">{s.dhcpStart} – {s.dhcpEnd} ({s.usage.pool})</span>],
                ["DNS", s.dns && <span className="font-mono">{s.dns}</span>],
                ["Site", s.location && <Link className="text-brand hover:underline" href={`/locations/${s.location.id}`}>{s.location.name}</Link>],
                ["Assigned / reserved / DHCP", `${s.usage.assigned} / ${s.usage.reserved} / ${s.usage.dhcp}`],
                ["Next free", s.nextFree && <span className="font-mono">{s.nextFree}</span>],
              ]}
            />
            {s.notes && <p className="mt-3 whitespace-pre-wrap border-t border-line pt-3 text-sm">{s.notes}</p>}
          </Card>
        </div>
      </div>
    </>
  );
}

type IpRecord = { status: keyof typeof IP_STATUS; hostname: string | null; macAddress: string | null; notes: string | null; asset: { id: string; tag: string; name: string } | null };

function IpForm({ action, address, record, submit, staticOnly }: { action: Parameters<typeof ActionForm>[0]["action"]; address?: string; record?: IpRecord; submit: string; staticOnly?: boolean }) {
  const statuses = Object.entries(IP_STATUS).filter(([k]) => !staticOnly || k === "ASSIGNED" || k === "RESERVED");
  return (
    <ActionForm action={action} className="space-y-3">
      {address && (
        <Field label="Address" name="address">
          <input type="hidden" name="address" value={address} />
          <Input value={address} readOnly aria-readonly className="bg-surface-2 font-mono" />
        </Field>
      )}
      <Field label="Status" name="status">
        <Select id="status" name="status" defaultValue={record?.status ?? "ASSIGNED"}>
          {statuses.map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Select>
      </Field>
      <Field label="Hostname" name="hostname"><Input id="hostname" name="hostname" defaultValue={record?.hostname ?? ""} className="font-mono" /></Field>
      <Field label="Device" name="assetId">
        <RemotePicker name="assetId" kind="assets" initial={record?.asset ? { id: record.asset.id, label: `${record.asset.tag} · ${record.asset.name}` } : null} />
      </Field>
      <Field label="MAC address" name="macAddress"><Input id="macAddress" name="macAddress" defaultValue={record?.macAddress ?? ""} className="font-mono" /></Field>
      <Field label="Notes" name="notes"><Textarea id="notes" name="notes" defaultValue={record?.notes ?? ""} className="min-h-16" /></Field>
      <Submit>{submit}</Submit>
    </ActionForm>
  );
}
