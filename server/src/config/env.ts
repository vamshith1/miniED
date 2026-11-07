import "dotenv/config";
import { z } from "zod";

// Validate environment variables once at startup, so a missing value
// fails fast with a clear message instead of breaking later at runtime.
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  // Optional: without it (or if Redis is down) the cache runs in memory.
  REDIS_URL: z.string().optional(),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  JWT_EXPIRES_IN: z.string().default("1d"),
  CLIENT_URL: z.string().default("http://localhost:5173"),
  // Uploaded files (resumes). Relative paths are inside server/.
  UPLOAD_DIR: z.string().default("uploads"),

  // ── Email ──
  // Without SMTP_URL, emails are written to server/.outbox/<id>.eml instead of sent.
  SMTP_URL: z.string().optional(), // e.g. smtps://user:pass@smtp.example.com:465
  MAIL_FROM: z.string().default("MiniEdCRM <no-reply@miniedcrm.test>"),
  // Where jobs live. auto = Redis if reachable, otherwise Postgres.
  QUEUE_BACKEND: z.enum(["auto", "redis", "postgres"]).default("auto"),
  // Also process jobs inside the API process. Set false when running `npm run worker` separately.
  RUN_WORKER: z.stringbool().default(true),
  EMAIL_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  EMAIL_RETRY_DELAY_MS: z.coerce.number().int().min(100).default(30_000), // doubles each retry
  // When the daily follow-up reminders go out (cron, server timezone). 9:00 every day by default.
  FOLLOW_UP_CRON: z.string().default("0 9 * * *"),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:");
  console.error(z.prettifyError(parsed.error));
  process.exit(1);
}

export const env = parsed.data;
