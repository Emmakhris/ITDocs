"use client";

import { ActionForm, ConfirmSubmit } from "@/components/form";
import type { ActionState } from "@/server/lib/forms";

export function DeleteLocation({ action }: { action: (p: ActionState) => Promise<ActionState> }) {
  return (
    <ActionForm action={action} className="text-right">
      <ConfirmSubmit message="Delete this location? Only empty locations can be deleted.">Delete location</ConfirmSubmit>
    </ActionForm>
  );
}
