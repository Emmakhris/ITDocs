import { api } from "@/server/api/handler";
import { db } from "@/server/db";

/** Asset types and their custom field definitions (needed to create assets). */
export const GET = api("assets", "read", async () => ({
  data: (await db.assetType.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" } })).map((t) => ({
    id: t.id,
    name: t.name,
    isMedical: t.isMedical,
    tagPrefix: t.tagPrefix,
    fields: t.fieldDefs,
  })),
}));
