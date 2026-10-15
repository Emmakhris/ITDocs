import Link from "next/link";
import { requireCtx } from "@/server/auth/session";
import { NODE_TYPES, layout, relationsFor, type MapNode, type NodeType } from "@/server/modules/relations";
import { globalSearch } from "@/server/modules/search";
import { NotFoundError } from "@/server/lib/errors";
import { Button, Card, Empty, Input, PageHeader, Table } from "@/components/ui";
import { DiagramTabs } from "../shared";

export const metadata = { title: "Relationship map" };

// Distinct hues that read on both light and dark backgrounds
const COLOR: Record<NodeType, string> = {
  Asset: "#0e7fc0",
  Location: "#2f9e44",
  Person: "#c2410c",
  Vendor: "#7c3aed",
  Contract: "#9333ea",
  Software: "#0891b2",
  License: "#0d9488",
  Article: "#ca8a04",
  Change: "#db2777",
  Incident: "#dc2626",
  Subnet: "#4f46e5",
  Diagram: "#64748b",
  Credential: "#b45309",
};
const TYPE_LABEL: Record<NodeType, string> = { Asset: "Asset", Location: "Location", Person: "Person", Vendor: "Vendor", Contract: "Contract", Software: "Software", License: "Licence", Article: "Article", Change: "Change", Incident: "Incident", Subnet: "Subnet", Diagram: "Diagram", Credential: "Credential" };

// Search hit kinds → map node types
const HIT_TYPE: Record<string, NodeType> = { Asset: "Asset", Location: "Location", Person: "Person", Vendor: "Vendor", Contract: "Contract", Software: "Software", Licence: "License", Article: "Article", Change: "Change", Incident: "Incident", Subnet: "Subnet", Credential: "Credential" };

const mapHref = (n: Pick<MapNode, "type" | "id">) => `/diagrams/map?type=${n.type}&id=${n.id}`;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export default async function MapPage({ searchParams }: { searchParams: Promise<{ type?: string; id?: string; q?: string }> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const type = NODE_TYPES.find((t) => t === sp.type);
  const map = type && sp.id ? await relationsFor(ctx, type, sp.id).catch((e) => (e instanceof NotFoundError ? null : Promise.reject(e))) : null;
  const hits = sp.q ? (await globalSearch(ctx, sp.q, 6)).filter((h) => HIT_TYPE[h.kind]) : [];
  const SIZE = 760;
  const nodes = map ? layout(map, SIZE) : [];
  const c = SIZE / 2;

  return (
    <>
      <PageHeader title="Diagrams" subtitle="Network, floor and rack diagrams, and a map of how every record connects." />
      <DiagramTabs active="map" />

      <form className="mb-4 grid gap-2 sm:grid-cols-[minmax(0,24rem)_auto] sm:justify-start">
        <Input name="q" defaultValue={sp.q} placeholder="Find a starting point: asset tag, person, CHG/INC number…" aria-label="Find a record to map" />
        <Button variant="secondary">Find</Button>
      </form>

      {sp.q && (
        <Card title="Start from" className="mb-4">
          {hits.length ? (
            <ul className="grid gap-1 text-sm sm:grid-cols-2">
              {hits.map((h) => (
                <li key={h.kind + h.id}>
                  <Link href={mapHref({ type: HIT_TYPE[h.kind], id: h.id })} className="flex items-baseline gap-2 rounded px-2 py-1 hover:bg-surface-2">
                    <span className="w-20 shrink-0 text-[11px] uppercase tracking-wide text-muted">{h.kind}</span>
                    <span className="truncate text-brand">{h.title}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No matching records.</p>
          )}
        </Card>
      )}

      {!map ? (
        !sp.q && <Empty title="Pick a record to map">Search above, or use “Map” on an asset, location or diagram page. Click any node to re-centre the map on it.</Empty>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 rounded-lg border border-line bg-surface p-2">
            <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="mx-auto h-auto w-full max-w-[760px]" role="img" aria-label={`Records connected to ${map.center.label}`}>
              {nodes.map((n) => (
                <g key={`l-${n.node.key}`}>
                  <line x1={c} y1={c} x2={n.x} y2={n.y} stroke="var(--line)" strokeWidth={1.5} />
                  <text x={(c + n.x) / 2} y={(c + n.y) / 2 - 3} textAnchor="middle" fontSize={10} fill="var(--muted)" style={{ paintOrder: "stroke" }} stroke="var(--surface)" strokeWidth={3}>
                    {clip(n.label, 22)}
                  </text>
                </g>
              ))}
              {nodes.map((n) => (
                <a key={n.node.key} href={mapHref(n.node)}>
                  <title>{`${TYPE_LABEL[n.node.type]}: ${n.node.label}${n.node.sub ? ` — ${n.node.sub}` : ""} (click to map from here)`}</title>
                  <rect x={n.x - 62} y={n.y - 20} width={124} height={40} rx={8} fill="var(--surface)" stroke={COLOR[n.node.type]} strokeWidth={2} />
                  <text x={n.x} y={n.y - 4} textAnchor="middle" fontSize={9} fill={COLOR[n.node.type]} fontWeight={600}>{TYPE_LABEL[n.node.type].toUpperCase()}</text>
                  <text x={n.x} y={n.y + 10} textAnchor="middle" fontSize={11} fill="var(--fg)">{clip(n.node.label, 20)}</text>
                </a>
              ))}
              <a href={map.center.href}>
                <title>{`Open ${map.center.label}`}</title>
                <rect x={c - 90} y={c - 30} width={180} height={60} rx={10} fill={COLOR[map.center.type]} />
                <text x={c} y={c - 8} textAnchor="middle" fontSize={10} fill="#fff" fontWeight={600}>{TYPE_LABEL[map.center.type].toUpperCase()}</text>
                <text x={c} y={c + 8} textAnchor="middle" fontSize={13} fill="#fff" fontWeight={600}>{clip(map.center.label, 24)}</text>
                {map.center.sub && <text x={c} y={c + 22} textAnchor="middle" fontSize={10} fill="#fff" opacity={0.85}>{clip(map.center.sub, 30)}</text>}
              </a>
              {nodes.length === 0 && <text x={c} y={c + 60} textAnchor="middle" fontSize={12} fill="var(--muted)">No connected records you can see.</text>}
            </svg>
            <ul className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs text-muted">
              {[...new Set(nodes.map((n) => n.node.type))].map((t) => (
                <li key={t} className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: COLOR[t] }} />{TYPE_LABEL[t]}</li>
              ))}
            </ul>
          </div>

          <Card title={`${map.neighbours.length} connection${map.neighbours.length === 1 ? "" : "s"}${map.hidden ? ` (+${map.hidden} not shown)` : ""}`}>
            <p className="mb-3 text-sm">
              <Link href={map.center.href} className="font-medium text-brand hover:underline">{map.center.label}</Link>
              {map.center.sub && <span className="block text-xs text-muted">{map.center.sub}</span>}
            </p>
            <Table className="border-0">
              <thead><tr><th>Relation</th><th>Record</th><th /></tr></thead>
              <tbody>
                {map.neighbours.map((n) => (
                  <tr key={n.node.key}>
                    <td className="text-xs text-muted">{n.label}</td>
                    <td>
                      <Link href={n.node.href} className="text-brand hover:underline">{n.node.label}</Link>
                      <span className="block text-xs text-muted">{TYPE_LABEL[n.node.type]}{n.node.sub ? ` · ${n.node.sub}` : ""}</span>
                    </td>
                    <td><Link href={mapHref(n.node)} className="text-xs text-muted hover:text-fg" aria-label={`Map from ${n.node.label}`}>map</Link></td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </div>
      )}
      {type && sp.id && !map && <Empty title="Record not found">It may have been deleted, or you may not have access to it.</Empty>}
    </>
  );
}
