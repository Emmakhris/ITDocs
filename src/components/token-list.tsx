import { ActionForm, ConfirmSubmit } from "./form";
import { Badge, Table, fmtDate, fmtDateTime } from "./ui";
import { revokeTokenAction } from "@/app/(app)/profile/token-actions";

type Row = {
  id: string;
  name: string;
  prefix: string;
  readOnly: boolean;
  scopes: string[];
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  lastUsedIp: string | null;
  createdAt: Date;
  revokedAt: Date | null;
  user: { username: string; displayName: string };
};

/** API tokens table (profile: own tokens; admin: everyone's). */
export function TokenList({ tokens, showOwner, back }: { tokens: Row[]; showOwner?: boolean; back: string }) {
  if (!tokens.length) return <p className="text-sm text-muted">No API tokens.</p>;
  const now = Date.now();
  return (
    <Table className="border-0">
      <thead><tr><th>Token</th>{showOwner && <th>Owner</th>}<th>Access</th><th>Last used</th><th>Expires</th><th /></tr></thead>
      <tbody>
        {tokens.map((t) => {
          const expired = t.expiresAt && t.expiresAt.getTime() < now;
          const dead = !!t.revokedAt || !!expired;
          return (
            <tr key={t.id} className={dead ? "opacity-60" : undefined}>
              <td>
                <span className="font-medium">{t.name}</span>
                <span className="block font-mono text-xs text-muted">{t.prefix}…</span>
              </td>
              {showOwner && <td>{t.user.displayName}<span className="block text-xs text-muted">{t.user.username}</span></td>}
              <td className="text-xs">
                <Badge tone={t.readOnly ? "gray" : "amber"}>{t.readOnly ? "read-only" : "read/write"}</Badge>
                <span className="mt-1 block text-muted">{t.scopes.length ? t.scopes.join(", ") : "all modules"}</span>
              </td>
              <td className="text-xs">{t.lastUsedAt ? <>{fmtDateTime(t.lastUsedAt)}<span className="block text-muted">{t.lastUsedIp}</span></> : <span className="text-muted">never</span>}</td>
              <td className="whitespace-nowrap text-xs">{t.revokedAt ? <Badge tone="red">revoked</Badge> : expired ? <Badge tone="red">expired</Badge> : t.expiresAt ? fmtDate(t.expiresAt) : "never"}</td>
              <td className="text-right">
                {!dead && (
                  <ActionForm action={revokeTokenAction.bind(null, t.id, back)}>
                    <ConfirmSubmit message={`Revoke "${t.name}"? Anything using it stops working immediately.`}>Revoke</ConfirmSubmit>
                  </ActionForm>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}
