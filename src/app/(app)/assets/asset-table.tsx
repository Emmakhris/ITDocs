"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AssetStatus } from "@prisma/client";
import { ActionForm, Field, Submit } from "@/components/form";
import { Badge, Button, Empty, Input, Select, STATUS_META, StatusBadge, Table, fmtDate } from "@/components/ui";
import { LocationSelect, RemotePicker, type LocationOpt } from "@/components/pickers";
import { moveAction } from "./actions";

type Row = {
  id: string;
  tag: string;
  name: string;
  type: string;
  status: AssetStatus;
  serial: string | null;
  location: string | null;
  assignee: string | null;
  warrantyEnd: string | null;
  storesPhi: boolean;
};

export function AssetTable({
  rows,
  writable,
  locations,
  sort,
}: {
  rows: Row[];
  writable: boolean;
  locations: LocationOpt[];
  sort: { key: string; dir: "asc" | "desc"; hrefs: Record<string, string> };
}) {
  const router = useRouter();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState(false);
  const toggle = (id: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const all = rows.length > 0 && rows.every((r) => sel.has(r.id));

  if (!rows.length) return <Empty title="No assets match">Try a different search or filter.</Empty>;

  const Th = ({ k, children }: { k: string; children: React.ReactNode }) => (
    <th>
      {sort.hrefs[k] ? (
        <Link href={sort.hrefs[k]} className="hover:text-fg">
          {children}
          {sort.key === k && (sort.dir === "asc" ? " ▲" : " ▼")}
        </Link>
      ) : (
        children
      )}
    </th>
  );

  return (
    <>
      {sel.size > 0 && (
        <div className="sticky top-14 z-10 mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-brand bg-brand-soft px-3 py-2 text-sm">
          <strong>{sel.size} selected</strong>
          <Button size="sm" variant="secondary" onClick={() => router.push(`/assets/labels?ids=${[...sel].join(",")}`)}>
            Print labels
          </Button>
          {writable && (
            <Button size="sm" onClick={() => setBulk((b) => !b)}>
              Bulk move…
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setSel(new Set())}>
            Clear
          </Button>
        </div>
      )}
      {bulk && sel.size > 0 && (
        <div className="mb-3 rounded-lg border border-line bg-surface p-4">
          <ActionForm
            action={moveAction.bind(null, [...sel], "MANUAL")}
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
            onSuccess={() => {
              setSel(new Set());
              setBulk(false);
              router.refresh();
            }}
          >
            <Field label="New location" name="toLocationId">
              <LocationSelect id="toLocationId" name="toLocationId" locations={locations} emptyLabel="— Keep current —" />
            </Field>
            <Field label="New assignee" name="toAssigneeId">
              <RemotePicker id="toAssigneeId" name="toAssigneeId" kind="people" placeholder="Keep current…" />
            </Field>
            <Field label="New status" name="toStatus">
              <Select id="toStatus" name="toStatus" defaultValue="">
                <option value="">— Keep current —</option>
                {Object.entries(STATUS_META)
                  .filter(([k]) => k !== "DISPOSED")
                  .map(([k, m]) => (
                    <option key={k} value={k}>{m.label}</option>
                  ))}
              </Select>
            </Field>
            <Field label="Ticket #" name="ticketRef"><Input id="ticketRef" name="ticketRef" /></Field>
            <Field label="Reason" name="reason" required className="sm:col-span-2 lg:col-span-3">
              <Input id="reason" name="reason" placeholder="e.g. Ward 4 refresh project" />
            </Field>
            <div className="flex items-end"><Submit>Move {sel.size} asset{sel.size === 1 ? "" : "s"}</Submit></div>
          </ActionForm>
        </div>
      )}
      <Table>
        <thead>
          <tr>
            <th className="w-8">
              <input type="checkbox" aria-label="Select all" checked={all} onChange={() => setSel(all ? new Set() : new Set(rows.map((r) => r.id)))} />
            </th>
            <Th k="tag">Tag</Th>
            <Th k="name">Name</Th>
            <th className="hidden md:table-cell">Type</th>
            <Th k="status">Status</Th>
            <th>Location</th>
            <th className="hidden lg:table-cell">Assigned to</th>
            <th className="hidden xl:table-cell">Serial</th>
            <Th k="warrantyEnd">Warranty</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => {
            const expired = a.warrantyEnd && new Date(a.warrantyEnd) < new Date();
            return (
              <tr key={a.id}>
                <td>
                  <input type="checkbox" aria-label={`Select ${a.tag}`} checked={sel.has(a.id)} onChange={() => toggle(a.id)} />
                </td>
                <td className="whitespace-nowrap font-mono text-xs">
                  <Link href={`/assets/${a.id}`} className="text-brand hover:underline">{a.tag}</Link>
                </td>
                <td>
                  <Link href={`/assets/${a.id}`} className="hover:underline">{a.name}</Link>
                  {a.storesPhi && <Badge tone="red" className="ml-1.5">PHI</Badge>}
                </td>
                <td className="hidden md:table-cell">{a.type}</td>
                <td><StatusBadge status={a.status} /></td>
                <td>{a.location ?? <span className="text-muted">—</span>}</td>
                <td className="hidden lg:table-cell">{a.assignee ?? <span className="text-muted">—</span>}</td>
                <td className="hidden font-mono text-xs xl:table-cell">{a.serial}</td>
                <td className={`whitespace-nowrap ${expired ? "text-muted line-through" : ""}`}>{fmtDate(a.warrantyEnd)}</td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </>
  );
}
