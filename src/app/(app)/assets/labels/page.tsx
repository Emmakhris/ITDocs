import QRCode from "qrcode";
import { requireCtx } from "@/server/auth/session";
import { assertCan } from "@/server/rbac/permissions";
import { getSettings } from "@/server/modules/settings";
import { db } from "@/server/db";
import { LinkButton, PageHeader } from "@/components/ui";
import { PrintButton } from "./print-button";

export const metadata = { title: "Print labels" };

/**
 * Printable asset labels. QR codes encode <APP_URL>/a/<tag> so a phone's native camera
 * opens the asset directly; the in-app scanner also understands bare tags.
 */
export default async function LabelsPage({ searchParams }: { searchParams: Promise<{ ids?: string; layout?: string }> }) {
  const ctx = await requireCtx();
  assertCan(ctx.user.role, "assets", "read");
  const sp = await searchParams;
  const ids = (sp.ids ?? "").split(",").filter(Boolean).slice(0, 300);
  const layout = sp.layout === "roll" ? "roll" : "sheet";
  const [assets, settings] = await Promise.all([
    db.asset.findMany({ where: { id: { in: ids }, deletedAt: null }, include: { type: true }, orderBy: { tag: "asc" } }),
    getSettings(),
  ]);
  const base = (process.env.APP_URL ?? "").replace(/\/$/, "");
  const labels = await Promise.all(
    assets.map(async (a) => ({
      ...a,
      svg: await QRCode.toString(`${base}/a/${encodeURIComponent(a.tag)}`, { type: "svg", margin: 0, errorCorrectionLevel: "M" }),
    })),
  );
  const href = (l: string) => `/assets/labels?ids=${ids.join(",")}&layout=${l}`;

  return (
    <>
      <div className="no-print">
        <PageHeader
          title="Print labels"
          subtitle={`${labels.length} label${labels.length === 1 ? "" : "s"} · ${layout === "sheet" ? "Letter/A4 sheet, 3 across (Avery 5160-style)" : "Label printer roll, 2.25 × 1.25 in"}`}
          crumbs={[{ href: "/assets", label: "Assets" }]}
          actions={
            <>
              <LinkButton href={href(layout === "sheet" ? "roll" : "sheet")}>{layout === "sheet" ? "Switch to roll printer" : "Switch to sheet"}</LinkButton>
              <PrintButton />
            </>
          }
        />
      </div>
      <style>{`
        .label { display:flex; gap:8px; align-items:center; overflow:hidden; background:#fff; color:#000; box-sizing:border-box; font-family: Arial, sans-serif; }
        .label .qr svg { width:100%; height:100%; }
        .sheet { display:grid; grid-template-columns: repeat(3, 2.625in); grid-auto-rows: 1in; column-gap: .125in; }
        .sheet .label { padding: .08in .12in; }
        .sheet .qr { width:.8in; height:.8in; flex:none; }
        .roll .label { width:2.25in; height:1.25in; padding:.08in; break-after:page; }
        .roll .qr { width:1in; height:1in; flex:none; }
        @media screen { .label { outline: 1px dashed #bbb; } .sheet, .roll { gap: 6px; } .roll { display:flex; flex-wrap:wrap; } }
        @media print {
          @page { margin: ${layout === "sheet" ? ".5in .19in" : "0"}; ${layout === "roll" ? "size: 2.25in 1.25in;" : ""} }
          header, aside { display:none !important; }
          main { padding:0 !important; max-width:none !important; }
        }
      `}</style>
      <div className={layout}>
        {labels.map((a) => (
          <div key={a.id} className="label">
            <div className="qr" dangerouslySetInnerHTML={{ __html: a.svg }} />
            <div style={{ minWidth: 0, lineHeight: 1.15 }}>
              <div style={{ fontSize: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>{settings.orgName}</div>
              <div style={{ fontSize: 14, fontWeight: 700, fontFamily: "Consolas, monospace" }}>{a.tag}</div>
              <div style={{ fontSize: 8, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.type.name}{a.serial ? ` · S/N ${a.serial}` : ""}</div>
              <div style={{ fontSize: 7, marginTop: 2 }}>{settings.labelSubtitle}</div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
