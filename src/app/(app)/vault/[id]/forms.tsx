"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { ActionForm, ConfirmSubmit, Submit } from "@/components/form";
import { RemotePicker } from "@/components/pickers";
import { deleteCredentialAction, linkAssetAction, unlinkAssetAction } from "../actions";

export function AssetLinks({
  credentialId,
  assets,
  editable,
}: {
  credentialId: string;
  assets: { id: string; tag: string; name: string; hostname: string | null }[];
  editable: boolean;
}) {
  return (
    <div className="space-y-3">
      {assets.length ? (
        <ul className="space-y-1 text-sm">
          {assets.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2">
              <Link className="min-w-0 truncate text-brand hover:underline" href={`/assets/${a.id}`}>
                <span className="font-mono text-xs">{a.tag}</span> {a.name}
              </Link>
              {editable && (
                <ActionForm action={unlinkAssetAction.bind(null, credentialId, a.id)}>
                  <button type="submit" className="text-muted hover:text-danger" aria-label={`Unlink ${a.tag}`}>
                    <X className="h-4 w-4" />
                  </button>
                </ActionForm>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">Not linked to any asset.</p>
      )}
      {editable && (
        <ActionForm action={linkAssetAction.bind(null, credentialId)} resetOnSuccess className="flex gap-2">
          <div className="flex-1">
            <RemotePicker name="assetId" kind="assets" placeholder="Link an asset…" />
          </div>
          <Submit variant="secondary">Link</Submit>
        </ActionForm>
      )}
    </div>
  );
}

export function DeleteCredential({ credentialId }: { credentialId: string }) {
  return (
    <ActionForm action={deleteCredentialAction.bind(null, credentialId)} className="text-right">
      <ConfirmSubmit message="Delete this credential? It disappears from the vault; the audit trail is kept.">Delete credential</ConfirmSubmit>
    </ActionForm>
  );
}
