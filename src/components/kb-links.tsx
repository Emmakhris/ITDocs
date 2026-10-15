import Link from "next/link";
import { Badge, Card, fmtDate } from "./ui";

type Linked = { id: string; title: string; status: string; reviewDueAt: Date | null };

/** Knowledge-base articles that document an asset or location. */
export function DocumentationCard({ articles, canWrite }: { articles: Linked[]; canWrite: boolean }) {
  const now = Date.now();
  return (
    <Card title="Documentation" actions={canWrite && <Link className="text-xs text-brand hover:underline" href="/kb/new">New article</Link>}>
      {articles.length ? (
        <ul className="space-y-1 text-sm">
          {articles.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-2">
              <Link className="text-brand hover:underline" href={`/kb/${a.id}`}>{a.title}</Link>
              {a.status !== "PUBLISHED" && <Badge>{a.status.toLowerCase()}</Badge>}
              {a.reviewDueAt && a.reviewDueAt.getTime() < now && <Badge tone="amber">review due {fmtDate(a.reviewDueAt)}</Badge>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No linked articles. Link one from the article&apos;s “Applies to” panel.</p>
      )}
    </Card>
  );
}
