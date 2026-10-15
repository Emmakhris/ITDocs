import Link from "next/link";
import type { AssetMovement, MoveMethod } from "@prisma/client";
import { Badge, STATUS_META, fmtDateTime } from "./ui";

const METHOD_LABEL: Record<MoveMethod, string> = {
  CREATE: "Created",
  MANUAL: "Moved",
  SCAN: "Scanned",
  CHECKOUT: "Checked out",
  CHECKIN: "Checked in",
  IMPORT: "Imported",
  BULK: "Bulk move",
  DISPOSAL: "Disposed",
};

type Mv = AssetMovement & { asset?: { id: string; tag: string; name: string } };

/** Vertical history of where an asset has been. */
export function MovementTimeline({ items, showAsset }: { items: Mv[]; showAsset?: boolean }) {
  if (!items.length) return <p className="text-sm text-muted">No movements recorded.</p>;
  return (
    <ol className="relative ml-2 border-l border-line">
      {items.map((m) => (
        <li key={m.id} className="mb-4 ml-4">
          <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full border-2 border-surface bg-brand" />
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <Badge tone={m.method === "DISPOSAL" ? "red" : m.method === "CHECKOUT" ? "amber" : "blue"}>{METHOD_LABEL[m.method]}</Badge>
            {showAsset && m.asset && (
              <Link href={`/assets/${m.asset.id}`} className="font-medium hover:underline">
                {m.asset.tag} · {m.asset.name}
              </Link>
            )}
            <time className="text-xs text-muted" dateTime={m.movedAt.toISOString()}>{fmtDateTime(m.movedAt)}</time>
            <span className="text-xs text-muted">by {m.movedByName}</span>
          </div>
          <div className="mt-1 space-y-0.5 text-sm">
            {(m.fromLocationPath !== m.toLocationPath || m.method === "CREATE") && (
              <p>
                <span className="text-muted">Location:</span> {m.fromLocationPath ?? "—"} <span className="text-muted">→</span>{" "}
                <span className="font-medium">{m.toLocationPath ?? "—"}</span>
              </p>
            )}
            {m.fromAssignee !== m.toAssignee && (
              <p>
                <span className="text-muted">Assignee:</span> {m.fromAssignee ?? "—"} <span className="text-muted">→</span>{" "}
                <span className="font-medium">{m.toAssignee ?? "—"}</span>
              </p>
            )}
            {m.fromStatus !== m.toStatus && m.toStatus && (
              <p>
                <span className="text-muted">Status:</span> {m.fromStatus ? STATUS_META[m.fromStatus].label : "—"} <span className="text-muted">→</span>{" "}
                <span className="font-medium">{STATUS_META[m.toStatus].label}</span>
              </p>
            )}
            {(m.reason || m.ticketRef) && (
              <p className="text-muted">
                {m.reason}
                {m.ticketRef && <span className="ml-1 font-mono text-xs">[{m.ticketRef}]</span>}
              </p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
