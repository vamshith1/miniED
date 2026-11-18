import { execSync } from "node:child_process";
import pg from "pg";
import { TEST_DATABASE_URL } from "./test-env.js";

// Prisma's ?schema=public means something else to pg.
const pgUrl = (u: string) => {
  const url = new URL(u);
  url.searchParams.delete("schema");
  return url.toString();
};

async function ensureDatabase() {
  const target = new URL(pgUrl(TEST_DATABASE_URL));
  const name = decodeURIComponent(target.pathname.slice(1));
  const admin = new URL(target);
  admin.pathname = "/postgres";
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    if (!exists.rowCount) await client.query(`CREATE DATABASE "${name.replace(/"/g, '""')}" ENCODING 'UTF8' TEMPLATE template0`);
  } finally {
    await client.end();
  }
}

async function truncateAll() {
  const client = new pg.Client({ connectionString: pgUrl(TEST_DATABASE_URL) });
  await client.connect();
  try {
    const { rows } = await client.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'",
    );
    if (rows.length) await client.query(`TRUNCATE ${rows.map((r) => `"public"."${r.tablename}"`).join(", ")} CASCADE`);
    // Leftover email jobs from an earlier run.
    await client.query("DROP SCHEMA IF EXISTS bullmq CASCADE");
  } finally {
    await client.end();
  }
}

export default async function setup() {
  await ensureDatabase();
  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });
  await truncateAll();
}
