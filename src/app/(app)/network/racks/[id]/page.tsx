import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCtx } from "@/server/auth/session";
import { can } from "@/server/rbac/permissions";
import { getRack } from "@/server/modules/network";
import { NotFoundError } from "@/server/lib/errors";
import { db } from "@/server/db";
import { ActionForm, ConfirmSubmit, Field, Submit } from "@/components/form";
import { RemotePicker } from "@/components/pickers";
import { Card, Input, LinkButton, PageHeader, StatusBadge, cx } from "@/components/ui";
import { mountAction, unmountAction } from "../../actions";
import { UsageBar } from "../../_tabs/shared";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const r = await db.rack.findUnique({ where: { id: (await params).id }, select: { name: true } });
  return { title: r?.name ?? "Rack" };
}

const ROW = 26; // px per rack unit

export default async function RackPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ u?: string; mount?: string }> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  const sp = await searchParams;
  const rack = await getRack(ctx, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const writable = can(ctx.user.role, "network", "write");
  const editing = sp.mount ? rack.mounts.find((m) => m.id === sp.mount) : undefined;
  const occupied = new Set(rack.mounts.flatMap((m) => Array.from({ length: m.heightU }, (_, i) => m.positionU + i)));
  const usedU = occupied.size;
  const startU = Number(sp.u) || undefined;
  const units = Array.from({ length: rack.heightU }, (_, i) => rack.heightU - i); // top → bottom
  const rowOf = (u: number) => rack.heightU - u + 1; // CSS grid row for rack unit u

  return (
    <>
      <PageHeader
        crumbs={[{ href: "/network?tab=racks", label: "Network" }]}
        title={rack.name}
        subtitle={<span>{rack.heightU}U{rack.location && <> · <Link className="hover:underline" href={`/locations/${rack.location.id}`}>{rack.location.name}</Link></>}</span>}
        actions={writable && <LinkButton href={`/network?tab=racks&edit=${rack.id}`}>Edit rack</LinkButton>}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,440px)_1fr]">
        <Card title="Front elevation" actions={<UsageBar used={usedU} total={rack.heightU} />}>
          <div className="flex gap-1 rounded-md border-4 border-fg/70 bg-surface-2 p-1">
            <div className="grid w-7 shrink-0" style={{ gridTemplateRows: `repeat(${rack.heightU}, ${ROW}px)` }} aria-hidden>
              {units.map((u) => <span key={u} className="flex items-center justify-end pr-1 font-mono text-[10px] text-muted">{u}</span>)}
            </div>
            <ol className="grid min-w-0 flex-1 gap-y-px" style={{ gridTemplateRows: `repeat(${rack.heightU}, ${ROW - 1}px)` }} aria-label={`${rack.name} rack units, top to bottom`}>
              {units.filter((u) => !occupied.has(u)).map((u) => (
                <li key={`u${u}`} style={{ gridRow: rowOf(u) }} className="min-w-0">
                  {writable ? (
                    <Link href={`/network/racks/${rack.id}?u=${u}`} scroll={false} aria-label={`U${u} empty — mount something here`} className={cx("block h-full rounded-sm border border-dashed border-line/70 hover:border-brand hover:bg-brand-soft", startU === u && !editing && "border-brand bg-brand-soft")} />
                  ) : (
                    <span className="block h-full rounded-sm border border-dashed border-line/50" aria-label={`U${u} empty`} />
                  )}
                </li>
              ))}
              {rack.mounts.map((m) => {
                const top = m.positionU + m.heightU - 1;
                return (
                  <li key={m.id} style={{ gridRow: `${rowOf(top)} / span ${m.heightU}` }} className="min-w-0">
                    <Link
                      href={m.asset && !writable ? `/assets/${m.asset.id}` : `/network/racks/${rack.id}?mount=${m.id}`}
                      scroll={false}
                      className={cx(
                        "flex h-full items-center gap-2 overflow-hidden rounded-sm border px-2 text-xs",
                        m.asset ? "border-brand/50 bg-surface hover:bg-brand-soft" : "border-line bg-surface-2 text-muted hover:bg-surface",
                        editing?.id === m.id && "ring-2 ring-brand",
                      )}
                      title={`U${m.positionU}${m.heightU > 1 ? `–${top}` : ""}: ${m.asset ? `${m.asset.tag} · ${m.asset.name}` : m.label}`}
                    >
                      <span className="font-mono font-medium">{m.asset?.tag ?? m.label}</span>
                      {m.asset && <span className="truncate text-muted">{m.label ?? m.asset.name}</span>}
                    </Link>
                  </li>
                );
              })}
            </ol>
          </div>
          {writable && <p className="mt-2 text-xs text-muted">Click an empty unit to mount equipment there, or an item to change it.</p>}
        </Card>

        <div className="space-y-4">
          {writable && (
            <Card title={editing ? `Change ${editing.asset?.tag ?? editing.label}` : "Mount equipment"} actions={(editing || startU) && <Link href={`/network/racks/${rack.id}`} className="text-xs text-muted hover:text-fg" scroll={false}>Clear</Link>}>
              <ActionForm key={editing?.id ?? `new-${startU ?? ""}`} action={mountAction.bind(null, rack.id, editing?.id ?? null)} className="space-y-3">
                <Field label="Asset" name="assetId" hint="Or leave empty and give a label for patch panels, shelves, blanking plates">
                  <RemotePicker name="assetId" kind="assets" initial={editing?.asset ? { id: editing.asset.id, label: `${editing.asset.tag} · ${editing.asset.name}` } : null} />
                </Field>
                <Field label="Label" name="label"><Input id="label" name="label" defaultValue={editing?.label ?? ""} placeholder="e.g. Patch panel A" /></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Bottom unit (U)" name="positionU" required><Input id="positionU" name="positionU" type="number" min={1} max={rack.heightU} defaultValue={editing?.positionU ?? startU} /></Field>
                  <Field label="Height (U)" name="heightU" required><Input id="heightU" name="heightU" type="number" min={1} max={20} defaultValue={editing?.heightU ?? 1} /></Field>
                </div>
                <Submit>{editing ? "Save" : "Mount"}</Submit>
              </ActionForm>
              {editing && (
                <ActionForm action={unmountAction.bind(null, rack.id, editing.id)} className="mt-4 border-t border-line pt-4 text-right">
                  <ConfirmSubmit message="Remove this item from the rack? The asset record itself is kept.">Remove from rack</ConfirmSubmit>
                </ActionForm>
              )}
            </Card>
          )}

          <Card title={`Contents (${rack.mounts.length})`}>
            {rack.mounts.length ? (
              <ul className="divide-y divide-line text-sm">
                {rack.mounts.map((m) => (
                  <li key={m.id} className="flex items-center gap-3 py-2">
                    <span className="w-16 shrink-0 font-mono text-xs text-muted">U{m.positionU}{m.heightU > 1 && `–${m.positionU + m.heightU - 1}`}</span>
                    {m.asset ? (
                      <span className="min-w-0 flex-1 truncate">
                        <Link className="font-mono text-brand hover:underline" href={`/assets/${m.asset.id}`}>{m.asset.tag}</Link> {m.asset.name}
                        <span className="ml-1 text-xs text-muted">{m.asset.type.name}</span>
                      </span>
                    ) : (
                      <span className="min-w-0 flex-1 truncate text-muted">{m.label}</span>
                    )}
                    {m.asset && <StatusBadge status={m.asset.status} />}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">Empty rack.</p>
            )}
          </Card>
          {rack.notes && <Card title="Notes"><p className="whitespace-pre-wrap text-sm">{rack.notes}</p></Card>}
        </div>
      </div>
    </>
  );
}
