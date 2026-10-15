import { requireCtx } from "@/server/auth/session";
import { assertCan } from "@/server/rbac/permissions";
import { listFolders } from "@/server/modules/vault";
import { db } from "@/server/db";
import { Empty, LinkButton, PageHeader } from "@/components/ui";
import { CredentialForm } from "../credential-form";
import { saveCredentialAction } from "../actions";

export const metadata = { title: "New credential" };

export default async function NewCredential({ searchParams }: { searchParams: Promise<{ folderId?: string; assetId?: string }> }) {
  const ctx = await requireCtx();
  assertCan(ctx.user.role, "vault", "write");
  const sp = await searchParams;
  const folders = (await listFolders(ctx)).filter((f) => f.myAccess === "edit").map((f) => ({ id: f.id, name: f.name }));
  const asset = sp.assetId ? await db.asset.findFirst({ where: { id: sp.assetId, deletedAt: null }, select: { id: true, tag: true, name: true } }) : null;

  return (
    <>
      <PageHeader
        title="New credential"
        subtitle={asset ? `Will be linked to ${asset.tag} · ${asset.name}` : undefined}
        crumbs={[{ href: "/vault", label: "Vault" }]}
      />
      {folders.length === 0 ? (
        <Empty title="No folder you can write to">
          {ctx.user.role === "ADMIN" ? <LinkButton href="/vault/folders/new" className="mt-2">Create a folder</LinkButton> : "Ask an administrator for edit access to a folder."}
        </Empty>
      ) : (
        <CredentialForm
          action={saveCredentialAction.bind(null, null)}
          folders={folders}
          values={{ folderId: sp.folderId ?? (folders.length === 1 ? folders[0].id : undefined) }}
          assetId={asset?.id}
          cancelHref={asset ? `/assets/${asset.id}` : "/vault"}
        />
      )}
    </>
  );
}
