import Link from "next/link";
import { FileText } from "lucide-react";
import type { DiagramKind } from "@prisma/client";
import { requireCtx } from "@/server/auth/session";
import { assertCan, can } from "@/server/rbac/permissions";
import { listDiagrams } from "@/server/modules/diagrams";
import { locationTree } from "@/server/modules/locations";
import { ActionForm, Field, Submit } from "@/components/form";
import { LocationSelect } from "@/components/pickers";
import { Badge, Button, Card, Empty, Input, LinkButton, PageHeader, Select, Textarea, fmtDate } from "@/components/ui";
import { createDiagramAction } from "./actions";
import { DIAGRAM_KIND, DiagramTabs, isImage } from "./shared";

export const metadata = { title: "Diagrams" };

export default async function DiagramsPage({ searchParams }: { searchParams: Promise<{ q?: string; kind?: string; new?: string }> }) {
  const ctx = await requireCtx();
  assertCan(ctx.user.role, "network", "read");
  const sp = await searchParams;
  const kind = sp.kind && sp.kind in DIAGRAM_KIND ? (sp.kind as DiagramKind) : undefined;
  const writable = can(ctx.user.role, "network", "write");
  const [rows, locations] = await Promise.all([listDiagrams(ctx, { q: sp.q, kind }), writable && sp.new ? locationTree() : []]);

  return (
    <>
      <PageHeader
        title="Diagrams"
        subtitle="Network, floor and rack diagrams, and a map of how every record connects."
        actions={writable && !sp.new && <LinkButton href="/diagrams?new=1" variant="primary">Upload diagram</LinkButton>}
      />
      <DiagramTabs active="list" />

      {writable && sp.new && (
        <Card title="Upload diagram" className="mb-4">
          <ActionForm action={createDiagramAction} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Title" name="title" required className="sm:col-span-2"><Input id="title" name="title" placeholder="e.g. Tower A floor 1 — network" /></Field>
              <Field label="Kind" name="kind">
                <Select id="kind" name="kind" defaultValue="NETWORK">{Object.entries(DIAGRAM_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
              </Field>
              <Field label="Location" name="locationId"><LocationSelect id="locationId" name="locationId" locations={locations} /></Field>
              <Field label="File" name="file" required className="sm:col-span-2" hint="PNG, JPEG, GIF, WebP, SVG, PDF, draw.io or Visio — up to 10 MB. Images are shown in the page.">
                <input id="file" name="file" type="file" accept=".png,.jpg,.jpeg,.gif,.webp,.svg,.pdf,.drawio,.xml,.vsdx" className="block w-full text-sm file:mr-2 file:rounded file:border file:border-line file:bg-surface-2 file:px-2 file:py-1 file:text-sm" />
              </Field>
              <Field label="Description" name="description" className="sm:col-span-2"><Textarea id="description" name="description" className="min-h-16" /></Field>
            </div>
            <div className="flex gap-2"><Submit>Upload</Submit><LinkButton href="/diagrams">Cancel</LinkButton></div>
          </ActionForm>
        </Card>
      )}

      <form className="mb-4 grid gap-2 sm:grid-cols-[minmax(0,20rem)_12rem_auto] sm:justify-start">
        <Input name="q" defaultValue={sp.q} placeholder="Search diagrams…" aria-label="Search diagrams" />
        <Select name="kind" defaultValue={sp.kind ?? ""} aria-label="Kind">
          <option value="">All kinds</option>
          {Object.entries(DIAGRAM_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Button variant="secondary">Filter</Button>
      </form>

      {rows.length === 0 ? (
        <Empty title="No diagrams yet">{writable && "Upload network drawings, floor plans or draw.io exports, and link them to locations and assets."}</Empty>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((d) => (
            <li key={d.id}>
              <Link href={`/diagrams/${d.id}`} className="block h-full overflow-hidden rounded-lg border border-line bg-surface hover:border-brand">
                <div className="flex h-44 items-center justify-center bg-surface-2">
                  {d.file && isImage(d.file.mimeType) ? (
                    // eslint-disable-next-line @next/next/no-img-element -- auth-protected file route, not optimisable
                    <img src={`/api/files/${d.file.id}?view=1`} alt="" className="max-h-44 w-full object-contain" loading="lazy" />
                  ) : (
                    <span className="flex flex-col items-center gap-1 text-xs text-muted"><FileText className="h-8 w-8" aria-hidden />{d.file?.fileName}</span>
                  )}
                </div>
                <div className="p-3">
                  <p className="font-medium text-brand">{d.title}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                    <Badge>{DIAGRAM_KIND[d.kind]}</Badge>
                    {d.location && <span>{d.location.name}</span>}
                    <span>updated {fmtDate(d.updatedAt)}</span>
                    {d.versions > 1 && <span>{d.versions} versions</span>}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
