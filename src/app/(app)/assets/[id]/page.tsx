import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCtx } from "@/server/auth/session";
import { can } from "@/server/rbac/permissions";
import { assetAt, assetMovements, getAsset } from "@/server/modules/assets";
import { entityHistory } from "@/server/modules/audit-query";
import { locationTree } from "@/server/modules/locations";
import { getSettings } from "@/server/modules/settings";
import { credentialsForAsset } from "@/server/modules/vault";
import { assetNetwork } from "@/server/modules/network";
import { articlesFor } from "@/server/modules/kb";
import { DocumentationCard } from "@/components/kb-links";
import { SeatsCard } from "@/components/seats-card";
import { RenewalBadge } from "@/components/renewal-badge";
import { seatsFor } from "@/server/modules/software";
import { contractsForAsset } from "@/server/modules/vendors";
import { recordsForAsset } from "@/server/modules/changes";
import { diagramsFor } from "@/server/modules/diagrams";
import { externalRefsFor } from "@/server/modules/sync";
import { changeNo, incidentNo } from "@/server/lib/workflow";
import { NotFoundError } from "@/server/lib/errors";
import { db } from "@/server/db";
import { Badge, Card, DL, LinkButton, PageHeader, StatusBadge, fmtDate, fmtDateTime, Input, Button } from "@/components/ui";
import { MovementTimeline } from "@/components/movement-timeline";
import { ConfirmSubmit } from "@/components/form";
import { AssetActionPanels } from "./panels";
import { deleteAssetAction } from "../actions";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const a = await db.asset.findUnique({ where: { id: (await params).id }, select: { tag: true } });
  return { title: a?.tag ?? "Asset" };
}

export default async function AssetDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ at?: string; action?: string }>;
}) {
  const ctx = await requireCtx();
  const { id } = await params;
  const sp = await searchParams;
  const a = await getAsset(ctx, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const [movements, history, locations, settings, credentials, network, articles, seats, contracts, records, diagrams, refs] = await Promise.all([
    assetMovements(ctx, a.id),
    entityHistory("Asset", a.id),
    locationTree(),
    getSettings(),
    credentialsForAsset(ctx, a.id),
    assetNetwork(ctx, a.id),
    articlesFor(ctx, "Asset", a.id),
    seatsFor(ctx, { assetId: a.id }),
    contractsForAsset(ctx, a.id),
    recordsForAsset(ctx, a.id),
    diagramsFor(ctx, { assetId: a.id }),
    externalRefsFor("Asset", a.id),
  ]);
  const atDate = sp.at ? new Date(sp.at) : null;
  const atResult = atDate && !Number.isNaN(atDate.getTime()) ? await assetAt(ctx, a.id, atDate) : null;
  const writable = can(ctx.user.role, "assets", "write");
  const openCheckout = a.checkouts.find((c) => !c.returnedAt);
  const cf = a.customFields as Record<string, unknown>;
  const disposed = a.status === "DISPOSED";
  const days = (d: Date | null) => (d ? Math.round((d.getTime() - Date.now()) / 86_400_000) : null);
  const w = days(a.warrantyEnd);

  return (
    <>
      <PageHeader
        crumbs={[{ href: "/assets", label: "Assets" }]}
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{a.tag}</span>
            <span className="font-normal text-muted">·</span>
            {a.name}
          </span>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={a.status} />
            <span>{a.type.name}</span>
            {a.storesPhi && <Badge tone="red">PHI</Badge>}
            {openCheckout && <Badge tone="amber">On loan to {openCheckout.person.name}</Badge>}
          </span>
        }
        actions={
          <>
            <LinkButton href={`/diagrams/map?type=Asset&id=${a.id}`}>Map</LinkButton>
            <LinkButton href={`/assets/labels?ids=${a.id}`}>Print label</LinkButton>
            {writable && !disposed && <LinkButton href={`/assets/${a.id}/edit`} variant="primary">Edit</LinkButton>}
          </>
        }
      />

      {writable && (
        <div className="mb-4">
          <AssetActionPanels
            assetId={a.id}
            locations={locations.map((l) => ({ id: l.id, name: l.name, path: l.path, depth: l.depth }))}
            checkedOut={!!openCheckout}
            disposed={disposed}
            storesPhi={a.storesPhi}
            initialTab={sp.action as "move" | undefined}
          />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Current placement">
            <DL
              items={[
                ["Location", a.location ? <Link className="text-brand hover:underline" href={`/locations/${a.location.id}`}>{a.locationPath}</Link> : null],
                ["Assigned to", a.assignee ? <Link className="text-brand hover:underline" href={`/people/${a.assignee.id}`}>{a.assignee.name}</Link> : null],
                ["Department", a.department?.name],
                ["Last movement", movements[0] ? `${fmtDateTime(movements[0].movedAt)} by ${movements[0].movedByName}` : null],
              ]}
            />
          </Card>

          <Card title="Details">
            <DL
              items={[
                ["Manufacturer", a.manufacturer],
                ["Model", a.model],
                ["Serial number", a.serial && <span className="font-mono">{a.serial}</span>],
                ["Hostname", a.hostname && <span className="font-mono">{a.hostname}</span>],
                ["IP address", a.ipAddress && <span className="font-mono">{a.ipAddress}</span>],
                ["MAC address", a.macAddress && <span className="font-mono">{a.macAddress}</span>],
                ["Operating system", a.os],
                ...a.fieldDefs.map((d): [string, React.ReactNode] => {
                  const v = cf[d.key];
                  return [
                    d.label,
                    d.kind === "boolean" ? (v ? "Yes" : "No") : d.kind === "url" && v ? <a className="text-brand hover:underline" href={String(v)} target="_blank" rel="noreferrer">{String(v)}</a> : v === undefined || v === null ? null : String(v),
                  ];
                }),
              ]}
            />
          </Card>

          {network && (network.ips.length > 0 || network.links.length > 0 || network.mount || Object.keys(network.ports).length > 0) && (
            <Card title="Network">
              <DL
                items={[
                  [
                    "IP addresses",
                    network.ips.length > 0 && (
                      <ul className="space-y-0.5">
                        {network.ips.map((ip) => (
                          <li key={ip.id}>
                            <Link className="font-mono text-brand hover:underline" href={`/network/subnets/${ip.subnetId}?ip=${ip.address}`}>{ip.address}</Link>
                            <span className="ml-1 text-xs text-muted">
                              {[ip.status.toLowerCase(), ip.hostname, ip.subnet.cidr, ip.subnet.vlan && `VLAN ${ip.subnet.vlan.number}`].filter(Boolean).join(" · ")}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ),
                  ],
                  [
                    "Switch port",
                    network.links.length > 0 && (
                      <ul className="space-y-0.5">
                        {network.links.map((p) => (
                          <li key={p.id}>
                            <Link className="text-brand hover:underline" href={`/network?tab=ports&switchId=${p.switch.id}`}>
                              <span className="font-mono">{p.switch.tag} {p.name}</span>
                            </Link>
                            <span className="ml-1 text-xs text-muted">
                              {[p.mode === "TRUNK" ? `trunk ${p.allowedVlans ?? "all"}` : p.vlan && `VLAN ${p.vlan.number}`, p.patchPanelPort && `panel ${p.patchPanelPort}`, p.wallJack && `jack ${p.wallJack}`].filter(Boolean).join(" · ")}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ),
                  ],
                  [
                    "Rack position",
                    network.mount && (
                      <Link className="text-brand hover:underline" href={`/network/racks/${network.mount.rack.id}`}>
                        {network.mount.rack.name} · U{network.mount.positionU}
                        {network.mount.heightU > 1 && `–${network.mount.positionU + network.mount.heightU - 1}`}
                        {network.mount.rack.location && ` (${network.mount.rack.location.name})`}
                      </Link>
                    ),
                  ],
                  ...(Object.keys(network.ports).length > 0
                    ? [[
                        "Ports on this device",
                        <Link key="ports" className="text-brand hover:underline" href={`/network?tab=ports&switchId=${a.id}`}>
                          {Object.values(network.ports).reduce((n, c) => n + (c ?? 0), 0)} documented ({network.ports.ACTIVE ?? 0} active)
                        </Link>,
                      ] as [string, React.ReactNode]]
                    : []),
                ]}
              />
            </Card>
          )}

          {settings.medicalModule && a.type.isMedical && (
            <Card title="Medical device">
              <DL
                items={[
                  ["UDI / device ID", a.udi],
                  ["Risk class", a.riskClass],
                  ["Biomed owner", a.biomedOwner],
                  ["PM interval", a.pmIntervalDays ? `${a.pmIntervalDays} days` : null],
                  ["Last PM", fmtDate(a.lastPmDate)],
                  [
                    "Next PM",
                    a.nextPmDate && (
                      <span className="flex items-center gap-2">
                        {fmtDate(a.nextPmDate)}
                        {(days(a.nextPmDate) ?? 1) < 0 && <Badge tone="red">Overdue</Badge>}
                      </span>
                    ),
                  ],
                  ["Segmented network", a.networkSegmented ? "Yes" : "No"],
                ]}
              />
            </Card>
          )}

          <Card
            title="Movement history"
            actions={
              <form className="flex items-center gap-2">
                <label htmlFor="at" className="text-xs text-muted">Where was it on</label>
                <Input id="at" type="datetime-local" name="at" defaultValue={sp.at} className="h-8 w-52" />
                <Button size="sm" variant="secondary">Check</Button>
              </form>
            }
          >
            {sp.at && (
              <div className="mb-4 rounded-md bg-brand-soft px-3 py-2 text-sm">
                {atResult ? (
                  <>
                    On {fmtDateTime(atDate)}: <strong>{atResult.toLocationPath ?? "no location"}</strong>
                    {atResult.toAssignee && <> , assigned to <strong>{atResult.toAssignee}</strong></>}
                    {atResult.toStatus && <> ({atResult.toStatus.replace("_", " ").toLowerCase()})</>}.
                  </>
                ) : (
                  "No record — the asset did not exist yet at that time."
                )}
              </div>
            )}
            <MovementTimeline items={movements} />
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Purchase & lifecycle">
            <DL
              items={[
                ["Vendor", a.vendorName],
                ["PO number", a.poNumber],
                ["Cost", a.purchaseCost ? Number(a.purchaseCost).toLocaleString(undefined, { minimumFractionDigits: 2 }) : null],
                ["Purchased", fmtDate(a.purchaseDate)],
                [
                  "Warranty end",
                  a.warrantyEnd && (
                    <span className="flex items-center gap-2">
                      {fmtDate(a.warrantyEnd)}
                      {w !== null && w < 0 && <Badge>expired</Badge>}
                      {w !== null && w >= 0 && w <= 90 && <Badge tone="amber">{w}d left</Badge>}
                    </span>
                  ),
                ],
                ["End of life", fmtDate(a.eolDate)],
              ]}
            />
          </Card>

          {a.disposal && (
            <Card title="Disposal record">
              <DL
                items={[
                  ["Date", fmtDate(a.disposal.disposedAt)],
                  ["Method", a.disposal.method],
                  ["Data wipe", a.disposal.wipeMethod],
                  ["Certificate", a.disposal.certificateRef],
                  ["Vendor", a.disposal.vendor],
                  ["Witness", a.disposal.witness],
                  ["Recorded by", a.disposal.recordedBy],
                ]}
              />
            </Card>
          )}

          <Card title="Check-out history">
            {a.checkouts.length ? (
              <ul className="divide-y divide-line text-sm">
                {a.checkouts.map((c) => (
                  <li key={c.id} className="py-2">
                    <p className="font-medium">{c.person.name}</p>
                    <p className="text-xs text-muted">
                      {fmtDate(c.outAt)} → {c.returnedAt ? fmtDate(c.returnedAt) : <span className="text-warn">not returned{c.dueAt && `, due ${fmtDate(c.dueAt)}`}</span>}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">Never checked out.</p>
            )}
          </Card>

          {a.notes && (
            <Card title="Notes">
              <p className="whitespace-pre-wrap text-sm">{a.notes}</p>
            </Card>
          )}

          {can(ctx.user.role, "vendors", "read") && contracts.length > 0 && (
            <Card title="Support contracts">
              <ul className="space-y-2 text-sm">
                {contracts.map((c) => (
                  <li key={c.id}>
                    <div className="flex flex-wrap items-center gap-2">
                      <Link className="text-brand hover:underline" href={`/vendors/contracts/${c.id}`}>{c.title}</Link>
                      <RenewalBadge state={c.state} date={c.state === "expired" ? c.endDate : c.noticeBy} />
                    </div>
                    <p className="text-xs text-muted">{[c.vendor.name, c.vendor.supportPhone && `support ${c.vendor.supportPhone}`, c.sla].filter(Boolean).join(" · ")}</p>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {records.changes.length + records.incidents.length > 0 && (
            <Card title="Changes & incidents">
              <ul className="space-y-1 text-sm">
                {records.incidents.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center gap-2">
                    <Badge tone={i.status === "RESOLVED" || i.status === "CLOSED" ? "gray" : "red"}>{i.severity}</Badge>
                    <Link className="min-w-0 truncate text-brand hover:underline" href={`/changes/incidents/${i.id}`}><span className="font-mono text-xs">{incidentNo(i.number)}</span> {i.title}</Link>
                    <span className="text-xs text-muted">{i.status.toLowerCase()} · {fmtDate(i.startedAt)}</span>
                  </li>
                ))}
                {records.changes.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-2">
                    <Badge>change</Badge>
                    <Link className="min-w-0 truncate text-brand hover:underline" href={`/changes/${c.id}`}><span className="font-mono text-xs">{changeNo(c.number)}</span> {c.title}</Link>
                    <span className="text-xs text-muted">{c.status.toLowerCase().replace("_", " ")}{c.plannedStart && ` · ${fmtDate(c.plannedStart)}`}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {can(ctx.user.role, "software", "read") && seats.length > 0 && <SeatsCard seats={seats} emptyText="" />}

          {refs.length > 0 && (
            <Card title="Seen by">
              <ul className="space-y-2 text-sm">
                {refs.map((r) => {
                  const d = r.data as Record<string, string | undefined>;
                  return (
                    <li key={r.id}>
                      <span className="font-medium">{r.source === "intune" ? "Intune" : r.source === "sccm" ? "ConfigMgr" : r.source}</span>
                      <span className="ml-1 text-xs text-muted">last {fmtDateTime(r.lastSeenAt)}</span>
                      {d.complianceState && <Badge className="ml-1" tone={d.complianceState === "compliant" ? "green" : "amber"}>{d.complianceState}</Badge>}
                      {d.user && <span className="block text-xs text-muted">user {d.user}</span>}
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}

          {diagrams.length > 0 && (
            <Card title="Diagrams">
              <ul className="space-y-1 text-sm">
                {diagrams.map((d) => <li key={d.id}><Link className="text-brand hover:underline" href={`/diagrams/${d.id}`}>{d.title}</Link></li>)}
              </ul>
            </Card>
          )}

          {can(ctx.user.role, "kb", "read") && <DocumentationCard articles={articles} canWrite={can(ctx.user.role, "kb", "write")} />}

          {can(ctx.user.role, "vault", "read") && (
            <Card title="Credentials" actions={<Link className="text-xs text-brand hover:underline" href={`/vault/new?assetId=${a.id}`}>Add</Link>}>
              {credentials.length ? (
                <ul className="space-y-1 text-sm">
                  {credentials.map((c) => (
                    <li key={c.id}>
                      <Link className="text-brand hover:underline" href={`/vault/${c.id}`}>{c.title}</Link>
                      {c.username && <span className="ml-1 font-mono text-xs text-muted">{c.username}</span>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">No linked credentials.</p>
              )}
            </Card>
          )}

          <Card title="Change history">
            <ul className="space-y-2 text-sm">
              {history.map((h) => (
                <li key={String(h.id)}>
                  <p>{h.summary}</p>
                  <p className="text-xs text-muted">{fmtDateTime(h.at)} · {h.actorName}</p>
                </li>
              ))}
            </ul>
          </Card>

          {writable && (
            <form action={deleteAssetAction.bind(null, a.id)} className="text-right">
              <ConfirmSubmit message="Delete this asset record? It will be hidden from lists but its history is kept in the audit log.">
                Delete record
              </ConfirmSubmit>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
