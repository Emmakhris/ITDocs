import { requireCtx } from "@/server/auth/session";
import { assertCan } from "@/server/rbac/permissions";
import { getSettings } from "@/server/modules/settings";
import { PageHeader } from "@/components/ui";
import { AdminNav } from "./admin-nav";
import { SettingsForm } from "./settings-form";

export const metadata = { title: "Administration" };

export default async function AdminPage() {
  const ctx = await requireCtx();
  assertCan(ctx.user.role, "admin", "read");
  const s = await getSettings();
  return (
    <>
      <PageHeader title="Administration" />
      <AdminNav current="/admin" />
      <SettingsForm values={s} />
    </>
  );
}
