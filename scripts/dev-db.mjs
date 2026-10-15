// Local development PostgreSQL without Docker: `npm run db:dev` (keep it running in its own terminal).
// Production uses the postgres service in docker-compose.yml.
import EmbeddedPostgres from "embedded-postgres";
import fs from "node:fs";
import path from "node:path";

const dataDir = path.resolve("data/pg");
const fresh = !fs.existsSync(path.join(dataDir, "PG_VERSION"));

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: "itdocs",
  password: "itdocs",
  port: 5433,
  persistent: true,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
});

if (fresh) await pg.initialise();
await pg.start();
try {
  await pg.createDatabase("itdocs");
} catch {
  /* already exists */
}
console.log("Dev PostgreSQL running on localhost:5433 (db itdocs). Ctrl+C to stop.");

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
setInterval(() => {}, 1 << 30);
