// Runs a real Postgres 17 server on your machine without Docker.
// It uses the same user, password, port and database as docker-compose.yml,
// so DATABASE_URL in .env works with either one.
//
// Usage: npm run db:local                 (keep this terminal open; Ctrl+C to stop)
//        npm run db:local -- --recreate   (drop the database and create it again, empty)
//
// The database is always UTF-8. Without that, Windows defaults to WIN1252,
// which can't store text like Hindi names or emoji.
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import { existsSync } from "node:fs";
import { join } from "node:path";

const DB_NAME = "miniedcrm";
const dataDir = join(import.meta.dirname, "..", ".pgdata");
const firstRun = !existsSync(join(dataDir, "PG_VERSION"));
const recreate = process.argv.includes("--recreate");

const pgServer = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: "miniedcrm",
  password: "miniedcrm",
  port: 5432,
  persistent: true, // keep data between restarts
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
});

if (firstRun) await pgServer.initialise();
await pgServer.start();

const admin = new pg.Client({ connectionString: "postgresql://miniedcrm:miniedcrm@localhost:5432/postgres" });
await admin.connect();
const { rows } = await admin.query<{ enc: string }>(
  "SELECT pg_encoding_to_char(encoding) AS enc FROM pg_database WHERE datname = $1",
  [DB_NAME],
);
const exists = rows.length > 0;

if (exists && recreate) {
  await admin.query(`DROP DATABASE ${DB_NAME} WITH (FORCE)`);
  console.log(`Dropped database ${DB_NAME}.`);
}
if (!exists || recreate) {
  // template0 lets us pick the encoding even when the server's default is WIN1252.
  // ICU gives friendly sorting (a, B, c); plain C is the fallback.
  try {
    await admin.query(
      `CREATE DATABASE ${DB_NAME} ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'en-IN' LOCALE 'C' TEMPLATE template0`,
    );
  } catch {
    await admin.query(`CREATE DATABASE ${DB_NAME} ENCODING 'UTF8' LOCALE 'C' TEMPLATE template0`);
  }
  console.log(`Created UTF-8 database ${DB_NAME}. Run npm run db:migrate and npm run db:seed next.`);
} else if (rows[0].enc !== "UTF8") {
  console.warn(
    `\nWarning: database ${DB_NAME} uses ${rows[0].enc}, not UTF-8, so text like Hindi names or emoji will fail.\n` +
      `Fix it (this deletes local data): npm run db:local -- --recreate, then db:migrate and db:seed.\n`,
  );
}
await admin.end();

console.log(`Postgres running on localhost:5432 (database: ${DB_NAME}). Press Ctrl+C to stop.`);

async function stop() {
  await pgServer.stop();
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
