import type { Role } from "@prisma/client";

/** Who is acting. Passed into every service call so RBAC + audit are applied consistently. */
export type Ctx = {
  user: { id: string; username: string; displayName: string; role: Role };
  ip?: string;
  userAgent?: string;
};
