/* Load-test data: `npm run db:seed-large -- 50000`. Adds N synthetic assets (with one movement each) to check list/search speed. */
import { PrismaClient, type AssetStatus } from "@prisma/client";

const db = new PrismaClient();
const N = Number(process.argv[2] ?? 50000);
const STATUSES: AssetStatus[] = ["DEPLOYED", "DEPLOYED", "DEPLOYED", "IN_STOCK", "IN_REPAIR", "LOANED", "RETIRED"];

async function main() {
  const [types, locs, people] = await Promise.all([
    db.assetType.findMany(),
    db.location.findMany({ where: { deletedAt: null } }),
    db.person.findMany({ take: 200 }),
  ]);
  if (!types.length || !locs.length) throw new Error("Run the normal seed first.");
  const run = Date.now().toString(36).toUpperCase();
  const batch = 2000;
  for (let start = 0; start < N; start += batch) {
    const rows = Array.from({ length: Math.min(batch, N - start) }, (_, j) => {
      const i = start + j;
      const t = types[i % types.length];
      return {
        id: `load${run}${i}`,
        tag: `LT${run}-${String(i).padStart(6, "0")}`,
        name: `${t.name} ${i}`,
        typeId: t.id,
        status: STATUSES[i % STATUSES.length],
        manufacturer: ["Dell", "HP", "Lenovo", "Cisco", "Philips", "BD"][i % 6],
        serial: `S${run}${(i * 7919).toString(36).toUpperCase()}`,
        hostname: i % 3 === 0 ? `LOAD-${i}` : null,
        locationId: locs[i % locs.length].id,
        assigneeId: i % 4 === 0 && people.length ? people[i % people.length].id : null,
        warrantyEnd: new Date(Date.now() + ((i % 1000) - 200) * 86_400_000),
        storesPhi: t.isMedical,
      };
    });
    await db.asset.createMany({ data: rows });
    await db.assetMovement.createMany({
      data: rows.map((r) => ({ assetId: r.id, method: "IMPORT" as const, movedByName: "load-test", toLocationId: r.locationId, toStatus: r.status, reason: "Synthetic load data" })),
    });
    process.stdout.write(`\r${start + rows.length}/${N}`);
  }
  console.log("\nDone.");
}

main().finally(() => db.$disconnect());
