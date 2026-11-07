// Runs a real Postgres 17 server on your machine without Docker.
// It uses the same user, password, port and database as docker-compose.yml,
// so DATABASE_URL in .env works with either one.
//
// Usage: npm run db:local   (keep this terminal open; Ctrl+C to stop)
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import { join } from "node:path";

const dataDir = join(import.meta.dirname, "..", ".pgdata");
const firstRun = !existsSync(join(dataDir, "PG_VERSION"));

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: "miniedcrm",
  password: "miniedcrm",
  port: 5432,
  persistent: true, // keep data between restarts
});

if (firstRun) await pg.initialise();
await pg.start();
if (firstRun) await pg.createDatabase("miniedcrm");

console.log("Postgres running on localhost:5432 (database: miniedcrm). Press Ctrl+C to stop.");

async function stop() {
  await pg.stop();
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
