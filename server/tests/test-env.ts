/**
 * Settings shared by global-setup.ts and setup-env.ts. The tests never touch the
 * development database: they use TEST_DATABASE_URL, or a "miniedcrm_test" database
 * on the same server as DATABASE_URL in .env.
 */
import "dotenv/config";

function testDatabaseUrl() {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const base = process.env.DATABASE_URL ?? "postgresql://miniedcrm:miniedcrm@localhost:5432/miniedcrm?schema=public";
  const url = new URL(base);
  url.pathname = "/miniedcrm_test";
  return url.toString();
}

export const TEST_DATABASE_URL = testDatabaseUrl();

// The global setup empties every table, so refuse anything that doesn't look like a test database.
if (!/test/i.test(new URL(TEST_DATABASE_URL).pathname)) {
  throw new Error(`Refusing to run tests against "${TEST_DATABASE_URL}": the database name must contain "test".`);
}

export const testEnv: Record<string, string> = {
  NODE_ENV: "test",
  DATABASE_URL: TEST_DATABASE_URL,
  JWT_SECRET: "test-only-secret-0123456789-abcdefghijklmnopqrstuvwxyz",
  REDIS_URL: "", // in-memory cache, no Redis needed
  QUEUE_BACKEND: "postgres",
  RUN_WORKER: "false", // emails are queued (EmailLog rows) but never sent
  SMTP_URL: "",
  BCRYPT_ROUNDS: "10",
  RATE_LIMIT_LOCAL: "false",
  TRUST_PROXY: "0",
  FILE_STORAGE: "database",
  CRON_SECRET: "test-cron-secret-0123456789abcdef",
};
