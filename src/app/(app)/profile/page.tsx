import QRCode from "qrcode";
import { requireCtx } from "@/server/auth/session";
import { ROLE_LABELS } from "@/server/rbac/permissions";
import { db } from "@/server/db";
import { newTotpSecret } from "@/server/modules/users";
import { getSettings } from "@/server/modules/settings";
import { Badge, Card, DL, PageHeader, fmtDateTime } from "@/components/ui";
import { PasswordForm, TotpForm } from "./forms";

export const metadata = { title: "My profile" };

export default async function ProfilePage() {
  const ctx = await requireCtx();
  const u = await db.user.findUniqueOrThrow({ where: { id: ctx.user.id } });
  const sessions = await db.session.findMany({ where: { userId: u.id }, orderBy: { lastSeenAt: "desc" } });
  let enrol: { secret: string; qr: string } | null = null;
  if (u.source === "LOCAL" && !u.totpEnabled) {
    const { secret, uri } = newTotpSecret(u.username, `ITDocs (${(await getSettings()).orgName})`);
    enrol = { secret, qr: await QRCode.toString(uri, { type: "svg", margin: 1 }) };
  }

  return (
    <>
      <PageHeader title="My profile" />
      <div className="grid max-w-5xl gap-4 lg:grid-cols-2">
        <Card title="Account">
          <DL
            items={[
              ["Name", u.displayName],
              ["Username", <span key="u" className="font-mono">{u.username}</span>],
              ["Role", ROLE_LABELS[u.role]],
              ["Account type", u.source === "LOCAL" ? <Badge key="s" tone="amber">Break-glass (local)</Badge> : "Active Directory"],
              ["MFA", u.source === "LOCAL" ? (u.totpEnabled ? "Authenticator app" : <Badge key="m" tone="red">Not enrolled</Badge>) : "Managed by your directory"],
              ["Email", u.email],
            ]}
          />
          <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-muted">Active sessions</h3>
          <ul className="space-y-1 text-xs">
            {sessions.map((s) => (
              <li key={s.id}>
                {fmtDateTime(s.lastSeenAt)} · {s.ip ?? "unknown IP"} · <span className="text-muted">{s.userAgent?.slice(0, 60)}</span>
              </li>
            ))}
          </ul>
        </Card>
        {u.source === "LOCAL" && (
          <div className="space-y-4">
            {enrol && (
              <Card title="Enrol authenticator (MFA)">
                <p className="mb-3 text-sm">Scan with Microsoft Authenticator, Google Authenticator or similar, then enter the 6-digit code.</p>
                <div className="mb-3 h-44 w-44 rounded bg-white p-1" dangerouslySetInnerHTML={{ __html: enrol.qr }} />
                <p className="mb-3 break-all font-mono text-xs text-muted">Manual key: {enrol.secret}</p>
                <TotpForm secret={enrol.secret} />
              </Card>
            )}
            <Card title="Change password">
              <PasswordForm />
            </Card>
          </div>
        )}
      </div>
    </>
  );
}
