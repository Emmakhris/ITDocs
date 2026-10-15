/**
 * Runs before the e2e server starts (see webServer in playwright.config.ts): brings the e2e
 * database up to date and seeds demo data plus the e2e admin. Non-destructive — migrations are
 * applied, never reset, and the seed skips data it has already created — so the specs use unique
 * names and never assume an empty database. Refuses any database whose name doesn't end in _e2e.
 */
import { execSync } from "node:child_process";

const url = process.env.DATABASE_URL ?? "";
const name = url ? new URL(url).pathname.slice(1) : "";
if (!name.endsWith("_e2e")) {
  console.error(`Refusing to prepare "${name || "(no DATABASE_URL)"}": the e2e database name must end in _e2e.`);
  process.exit(1);
}
const env = { ...process.env, NODE_ENV: "development" as const };
execSync("npx prisma migrate deploy", { stdio: "inherit", env });
execSync("npx tsx prisma/seed.ts", { stdio: "inherit", env });
