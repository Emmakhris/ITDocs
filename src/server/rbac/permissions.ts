import type { Role } from "@prisma/client";
import { ForbiddenError } from "../lib/errors";

export const MODULES = [
  "assets",
  "locations",
  "people",
  "vault",
  "network",
  "kb",
  "software",
  "vendors",
  "changes",
  "reports",
  "audit",
  "admin",
] as const;
export type Module = (typeof MODULES)[number];
export type Access = "none" | "read" | "write";

/** Default permission matrix. Vault access is further restricted per folder (Phase 3). */
const MATRIX: Record<Role, Partial<Record<Module, Access>> & { "*"?: Access }> = {
  ADMIN: { "*": "write" },
  TECHNICIAN: { "*": "write", audit: "none", admin: "none" },
  READONLY: { "*": "read", vault: "none", audit: "none", admin: "none" },
  AUDITOR: { "*": "read", vault: "none", audit: "read", admin: "none" },
};

export function accessFor(role: Role, module: Module): Access {
  const row = MATRIX[role];
  return row[module] ?? row["*"] ?? "none";
}

export function can(role: Role, module: Module, need: "read" | "write"): boolean {
  const a = accessFor(role, module);
  return need === "read" ? a !== "none" : a === "write";
}

export function assertCan(role: Role, module: Module, need: "read" | "write") {
  if (!can(role, module, need)) throw new ForbiddenError();
}

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Administrator",
  TECHNICIAN: "Technician",
  READONLY: "Read-only",
  AUDITOR: "Auditor",
};
