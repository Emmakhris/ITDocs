import { notFound, redirect } from "next/navigation";
import { requireCtx } from "@/server/auth/session";
import { db } from "@/server/db";

/** Target of printed QR codes: /a/<tag> → the scan quick-action page for that asset. */
export default async function TagRedirect({ params }: { params: Promise<{ tag: string }> }) {
  await requireCtx();
  const tag = decodeURIComponent((await params).tag);
  const a = await db.asset.findFirst({ where: { tag, deletedAt: null }, select: { id: true } });
  if (!a) notFound();
  redirect(`/scan/${a.id}`);
}
