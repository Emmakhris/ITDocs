import Link from "next/link";
import type { DiagramKind } from "@prisma/client";
import { cx } from "@/components/ui";

export const DIAGRAM_KIND: Record<DiagramKind, string> = { NETWORK: "Network", FLOOR_PLAN: "Floor plan", RACK: "Rack", PROCESS: "Process / flow", OTHER: "Other" };

export const isImage = (mime: string) => /^image\/(png|jpeg|gif|webp|svg\+xml)$/.test(mime);

export function DiagramTabs({ active }: { active: "list" | "map" }) {
  return (
    <nav className="mb-4 flex gap-1 border-b border-line" aria-label="Diagram sections">
      {[
        { key: "list", href: "/diagrams", label: "Diagrams" },
        { key: "map", href: "/diagrams/map", label: "Relationship map" },
      ].map((t) => (
        <Link key={t.key} href={t.href} aria-current={t.key === active ? "page" : undefined} className={cx("-mb-px border-b-2 px-3 py-2 text-sm font-medium", t.key === active ? "border-brand text-brand" : "border-transparent text-muted hover:text-fg")}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
