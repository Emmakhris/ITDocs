import { notFound } from "next/navigation";
import { requireCtx } from "@/server/auth/session";
import { getCredential, listFolders } from "@/server/modules/vault";
import { ForbiddenError, NotFoundError } from "@/server/lib/errors";
import { PageHeader } from "@/components/ui";
import { CredentialForm } from "../../credential-form";
import { saveCredentialAction } from "../../actions";

export const metadata = { title: "Edit credential" };

export default async function EditCredential({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  const c = await getCredential(ctx, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  if (c.myAccess !== "edit") throw new ForbiddenError();
  const folders = (await listFolders(ctx)).filter((f) => f.myAccess === "edit").map((f) => ({ id: f.id, name: f.name }));
  return (
    <>
      <PageHeader title={`Edit ${c.title}`} crumbs={[{ href: "/vault", label: "Vault" }, { href: `/vault/${id}`, label: c.title }]} />
      <CredentialForm
        action={saveCredentialAction.bind(null, id)}
        folders={folders}
        values={{ title: c.title, folderId: c.folderId, username: c.username, url: c.url, notes: c.notes, rotateEveryDays: c.rotateEveryDays }}
        isEdit
        hasTotp={c.hasTotp}
        cancelHref={`/vault/${id}`}
      />
    </>
  );
}
