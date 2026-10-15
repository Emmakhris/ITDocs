import { api } from "@/server/api/handler";
import { can } from "@/server/rbac/permissions";
import { API_MODULES } from "@/server/modules/api-tokens";

/** Who the token belongs to and what it can do. */
export const GET = api(null, "read", async ({ ctx, token }) => {
  const inScope = (m: string) => !token.scopes.length || token.scopes.includes(m);
  return {
    user: { id: ctx.user.id, username: ctx.user.username, displayName: ctx.user.displayName, role: ctx.user.role },
    token: { prefix: token.prefix, readOnly: token.readOnly, scopes: token.scopes.length ? token.scopes : "all" },
    access: Object.fromEntries(
      API_MODULES.map((m) => [m, !inScope(m) ? "none" : can(ctx.user.role, m, "write") && !token.readOnly ? "write" : can(ctx.user.role, m, "read") ? "read" : "none"]),
    ),
  };
});
