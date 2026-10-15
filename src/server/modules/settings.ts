import "server-only";
import { cache } from "react";
import { db } from "../db";
import { audit } from "../audit/log";
import { assertCan } from "../rbac/permissions";
import type { Ctx } from "../context";

export type AppSettings = {
  orgName: string;
  medicalModule: boolean;
  assetTagPrefix: string;
  labelSubtitle: string;
  /** Comma-separated addresses for the daily digest and incident alerts */
  alertRecipients: string;
  digestEnabled: boolean;
  /** Local hour (0–23) after which the daily digest is sent */
  digestHour: number;
  /** Send P1/P2 incidents to email + Teams as soon as they're opened or escalated */
  incidentAlerts: boolean;
};

export const DEFAULT_SETTINGS: AppSettings = {
  orgName: "My Organization",
  medicalModule: true,
  assetTagPrefix: "IT-",
  labelSubtitle: "Property of IT — call x1234",
  alertRecipients: "",
  digestEnabled: false,
  digestHour: 7,
  incidentAlerts: true,
};

export const getSettings = cache(async (): Promise<AppSettings> => {
  const rows = await db.setting.findMany();
  const s = { ...DEFAULT_SETTINGS } as Record<string, unknown>;
  for (const r of rows) if (r.key in s) s[r.key] = r.value;
  return s as AppSettings;
});

export async function updateSettings(ctx: Ctx, patch: Partial<AppSettings>) {
  assertCan(ctx.user.role, "admin", "write");
  const before = await getSettings();
  await db.$transaction(async (tx) => {
    for (const [key, value] of Object.entries(patch)) {
      if (!(key in DEFAULT_SETTINGS) || value === undefined) continue;
      await tx.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
    }
    await audit(tx, ctx, { action: "update", entityType: "Settings", summary: "Updated settings", before, after: patch });
  });
}
