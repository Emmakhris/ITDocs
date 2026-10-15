import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, FileText, Share2 } from "lucide-react";
import { requireCtx } from "@/server/auth/session";
import { can } from "@/server/rbac/permissions";
import { getDiagram } from "@/server/modules/diagrams";
import { locationTree } from "@/server/modules/locations";
import { NotFoundError } from "@/server/lib/errors";
import { db } from "@/server/db";
import { ActionForm, ConfirmSubmit, Field, Submit } from "@/components/form";
import { LocationSelect, RemotePicker } from "@/components/pickers";
import { Badge, Card, Input, LinkButton, PageHeader, Select, Textarea, fmtDateTime } from "@/components/ui";
import { deleteDiagramAction, linkDiagramAssetAction, unlinkDiagramAssetAction, updateDiagramAction, uploadVersionAction } from "../actions";
import { DIAGRAM_KIND, isImage } from "../shared";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const d = await db.diagram.findUnique({ where: { id: (await params).id }, select: { title: true } });
  return { title: d?.title ?? "Diagram" };
}

const size = (n: number) => (n < 1048576 ? `${Math.ceil(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);

export default async function DiagramPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string; v?: string }> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  const sp = await searchParams;
  const d = await getDiagram(ctx, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const writable = can(ctx.user.role, "network", "write");
  const shown = d.files.find((f) => f.id === sp.v) ?? d.files[0];
  const locations = writable && sp.edit ? await locationTree() : [];

  return (
    <>
      <PageHeader
        crumbs={[{ href: "/diagrams", label: "Diagrams" }]}
        title={d.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge>{DIAGRAM_KIND[d.kind]}</Badge>
            {d.location && <Link href={`/locations/${d.location.id}`} className="hover:underline">{d.location.name}</Link>}
            <span>added by {d.createdBy}</span>
          </span>
        }
        actions={
          <>
            <LinkButton href={`/diagrams/map?type=Diagram&id=${id}`}><Share2 className="h-4 w-4" aria-hidden /> Map</LinkButton>
            {shown && <LinkButton href={`/api/files/${shown.id}`} prefetch={false}><Download className="h-4 w-4" aria-hidden /> Download</LinkButton>}
            {writable && <LinkButton href={`/diagrams/${id}?edit=1`} variant="primary">Edit</LinkButton>}
          </>
        }
      />

      {writable && sp.edit && (
        <Card title="Edit details" className="mb-4">
          <ActionForm action={updateDiagramAction.bind(null, id)} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Title" name="title" required className="sm:col-span-2"><Input id="title" name="title" defaultValue={d.title} /></Field>
              <Field label="Kind" name="kind"><Select id="kind" name="kind" defaultValue={d.kind}>{Object.entries(DIAGRAM_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
              <Field label="Location" name="locationId"><LocationSelect id="locationId" name="locationId" locations={locations} defaultValue={d.locationId} /></Field>
              <Field label="Description" name="description" className="sm:col-span-2 lg:col-span-4"><Textarea id="description" name="description" defaultValue={d.description ?? ""} className="min-h-16" /></Field>
            </div>
            <div className="flex gap-2"><Submit>Save</Submit><LinkButton href={`/diagrams/${id}`}>Cancel</LinkButton></div>
          </ActionForm>
          <ActionForm action={deleteDiagramAction.bind(null, id)} className="mt-4 border-t border-line pt-4 text-right">
            <ConfirmSubmit message={`Delete "${d.title}"? Its files stay in storage and the audit log keeps the history.`}>Delete diagram</ConfirmSubmit>
          </ActionForm>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 rounded-lg border border-line bg-surface p-2">
          {shown && isImage(shown.mimeType) ? (
            <a href={`/api/files/${shown.id}?view=1`} target="_blank" rel="noopener noreferrer" title="Open full size">
              {/* eslint-disable-next-line @next/next/no-img-element -- auth-protected file route */}
              <img src={`/api/files/${shown.id}?view=1`} alt={d.title} className="mx-auto max-h-[75vh] w-auto max-w-full" />
            </a>
          ) : (
            <div className="flex flex-col items-center gap-2 py-16 text-center text-sm text-muted">
              <FileText className="h-10 w-10" aria-hidden />
              <p>{shown?.fileName} can&apos;t be shown in the page.</p>
              {shown && <LinkButton href={`/api/files/${shown.id}`} prefetch={false}>Download {shown.mimeType === "application/pdf" ? "PDF" : "file"}</LinkButton>}
              {shown?.mimeType.includes("jgraph") && <p className="text-xs">Open it in draw.io (desktop or diagrams.net). Export a PNG or SVG too if you want it shown here.</p>}
            </div>
          )}
          {d.description && <p className="mt-3 whitespace-pre-wrap px-2 pb-2 text-sm">{d.description}</p>}
        </div>

        <aside className="space-y-4">
          {can(ctx.user.role, "assets", "read") && (
            <Card title={`Shows (${d.assets.length})`}>
              {d.assets.length ? (
                <ul className="space-y-1 text-sm">
                  {d.assets.map((a) => (
                    <li key={a.id} className="flex items-center gap-2">
                      <Link href={`/assets/${a.id}`} className="min-w-0 flex-1 truncate text-brand hover:underline"><span className="font-mono">{a.tag}</span> {a.name}</Link>
                      {writable && (
                        <ActionForm action={unlinkDiagramAssetAction.bind(null, id, a.id)}>
                          <ConfirmSubmit variant="secondary" message={`Remove ${a.tag}?`}>✕</ConfirmSubmit>
                        </ActionForm>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">No assets linked.</p>
              )}
              {writable && (
                <ActionForm action={linkDiagramAssetAction.bind(null, id)} className="mt-3 space-y-2 border-t border-line pt-3">
                  <Field label="Link an asset shown on this diagram" name="assetId"><RemotePicker name="assetId" kind="assets" /></Field>
                  <Submit variant="secondary">Link</Submit>
                </ActionForm>
              )}
            </Card>
          )}
          <Card title={`Versions (${d.files.length})`}>
            <ol className="space-y-2 text-sm">
              {d.files.map((f, i) => (
                <li key={f.id} className={f.id === shown?.id ? "font-medium" : undefined}>
                  <Link href={`/diagrams/${id}?v=${f.id}`} className="text-brand hover:underline">{i === 0 ? "Current" : `Version ${d.files.length - i}`}</Link>
                  <span className="block text-xs font-normal text-muted">{f.fileName} · {size(f.size)} · {fmtDateTime(f.createdAt)} · {f.uploadedBy}</span>
                </li>
              ))}
            </ol>
            {writable && (
              <ActionForm action={uploadVersionAction.bind(null, id)} className="mt-3 space-y-2 border-t border-line pt-3" resetOnSuccess>
                <Field label="Upload a new version" name="file">
                  <input id="file" name="file" type="file" className="block w-full text-xs file:mr-2 file:rounded file:border file:border-line file:bg-surface-2 file:px-2 file:py-1 file:text-xs" />
                </Field>
                <Submit variant="secondary">Upload</Submit>
              </ActionForm>
            )}
          </Card>
        </aside>
      </div>
    </>
  );
}
