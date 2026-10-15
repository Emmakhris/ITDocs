import type { Prisma } from "@prisma/client";

/** Collapsible before/after view of an audit entry. */
export function AuditDetail({ before, after }: { before: Prisma.JsonValue; after: Prisma.JsonValue }) {
  const b = (before ?? {}) as Record<string, unknown>;
  const a = (after ?? {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((k) => !["id", "createdAt", "updatedAt"].includes(k));
  if (!keys.length) return null;
  const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));
  return (
    <details className="mt-1 text-xs">
      <summary className="cursor-pointer text-brand">Details</summary>
      <table className="mt-1 w-full">
        <tbody>
          {keys.map((k) => (
            <tr key={k}>
              <td className="py-0.5 pr-2 align-top font-medium">{k}</td>
              {before !== null && <td className="py-0.5 pr-2 align-top text-danger line-through decoration-danger/40">{show(b[k])}</td>}
              <td className="py-0.5 align-top text-ok">{show(a[k])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
