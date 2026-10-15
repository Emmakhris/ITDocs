import Link from "next/link";
import { Badge, Card, fmtDate } from "./ui";

type Seat = { id: string; assignedAt: Date; license: { id: string; name: string; expiresAt: Date | null; software: { id: string; name: string } } };

/** Software licence seats held by a device or a person. */
export function SeatsCard({ seats, emptyText }: { seats: Seat[]; emptyText: string }) {
  const now = Date.now();
  return (
    <Card title={`Software (${seats.length})`}>
      {seats.length ? (
        <ul className="space-y-1 text-sm">
          {seats.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-x-2">
              <Link className="text-brand hover:underline" href={`/software/licenses/${s.license.id}`}>{s.license.software.name}</Link>
              <span className="text-xs text-muted">{s.license.name}</span>
              {s.license.expiresAt && s.license.expiresAt.getTime() < now && <Badge tone="red">expired {fmtDate(s.license.expiresAt)}</Badge>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">{emptyText}</p>
      )}
    </Card>
  );
}
