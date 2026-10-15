import { requireCtx } from "@/server/auth/session";
import { assertCan } from "@/server/rbac/permissions";
import { PageHeader } from "@/components/ui";
import { FolderForm } from "../folder-forms";
import { saveFolderAction } from "../../actions";

export const metadata = { title: "New vault folder" };

export default async function NewFolder() {
  const ctx = await requireCtx();
  assertCan(ctx.user.role, "admin", "write");
  return (
    <>
      <PageHeader title="New vault folder" crumbs={[{ href: "/vault", label: "Vault" }]} />
      <FolderForm action={saveFolderAction.bind(null, null)} cancelHref="/vault" />
    </>
  );
}
