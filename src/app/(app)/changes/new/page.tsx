import { requireCtx } from "@/server/auth/session";
import { assertCan } from "@/server/rbac/permissions";
import { PageHeader } from "@/components/ui";
import { saveChangeAction } from "../actions";
import { ChangeForm } from "../change-form";

export const metadata = { title: "New change" };

export default async function NewChange() {
  const ctx = await requireCtx();
  assertCan(ctx.user.role, "changes", "write");
  return (
    <>
      <PageHeader crumbs={[{ href: "/changes", label: "Changes" }]} title="New change" subtitle="Saved as a draft. Submit it for approval when the plan is complete." />
      <ChangeForm action={saveChangeAction.bind(null, null)} cancelHref="/changes" />
    </>
  );
}
