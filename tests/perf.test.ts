import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { listAssets } from "@/server/modules/assets";
import { globalSearch } from "@/server/modules/search";
import type { Ctx } from "@/server/context";

// Opt-in: PERF=1 npx vitest run tests/perf.test.ts  (after `npm run db:seed-large` on the test DB)
const ctx: Ctx = { user: { id: "", username: "perf", displayName: "perf", role: "ADMIN" } };
const time = async (fn: () => Promise<unknown>) => {
  await fn(); // warm
  const t = performance.now();
  await fn();
  return Math.round(performance.now() - t);
};

describe.runIf(process.env.PERF === "1")("performance at scale", () => {
  it("pages, filters and searches assets quickly", async () => {
    const total = await db.asset.count();
    const site = await db.location.findFirstOrThrow({ where: { type: "SITE" } });
    const results = {
      total,
      firstPage: await time(() => listAssets(ctx, { page: 1 })),
      deepPage: await time(() => listAssets(ctx, { page: 500 })),
      statusFilter: await time(() => listAssets(ctx, { status: "IN_REPAIR" })),
      siteSubtree: await time(() => listAssets(ctx, { locationId: site.id })),
      textSearch: await time(() => listAssets(ctx, { q: "LOAD-4242" })),
      globalSearch: await time(() => globalSearch(ctx, "Infusion 123")),
    };
    console.table(results);
    expect(total).toBeGreaterThan(40_000);
    for (const [k, ms] of Object.entries(results)) if (k !== "total") expect(ms, k).toBeLessThan(500);
  });
});
