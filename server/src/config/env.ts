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
  // Where uploaded files (resumes) are kept. "database" works on any host, including
  // free ones whose disk is wiped on every deploy. "disk" suits a VPS with a volume.
  FILE_STORAGE: z.enum(["database", "disk"]).default("database"),
  // The built web app, served by the API when it exists. Relative paths are inside server/.
  CLIENT_DIST: z.string().default("../client/dist"),
  // Folder for FILE_STORAGE=disk (and older uploads). Relative paths are inside server/.
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

  // Lets a scheduler (GitHub Actions) trigger the daily reminders: POST /api/cron/follow-ups
  // with header X-Cron-Secret. Unset = that endpoint is off.
  CRON_SECRET: z.string().min(24, "CRON_SECRET must be at least 24 characters").optional(),

  // ── Security ──
  // Cost of password hashing (each +1 doubles the time). See lib/password.ts.
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(14).default(12),
  // How many proxies sit in front of the app (Render, Caddy, nginx: 1). Needed so
  // rate limits see each visitor's real IP instead of the proxy's.
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
  // In development, requests from this machine skip rate limits. true = apply them anyway.
  RATE_LIMIT_LOCAL: z.stringbool().default(false),

  // ── Payments (course fees) ──
  // razorpay = real gateway (test or live keys), fake = built-in test gateway for development
  // and tests (never in production), off = no payments. Default: fake in development, off in production.
  PAYMENT_PROVIDER: z.enum(["off", "fake", "razorpay"]).optional(),
  RAZORPAY_KEY_ID: z.string().optional(), // rzp_test_... or rzp_live_...; public, sent to the browser
  RAZORPAY_KEY_SECRET: z.string().optional(), // private: signs checkout results and calls the API
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(), // private: the secret set on the webhook in Razorpay's dashboard
});

// Settings that make no sense together, in any environment.
function configProblems(e: z.infer<typeof schema> & { PAYMENT_PROVIDER: string }) {
  const problems: string[] = [];
  if (e.PAYMENT_PROVIDER === "razorpay") {
    for (const k of ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"] as const) {
      if (!e[k]) problems.push(`${k} is required when PAYMENT_PROVIDER=razorpay.`);
    }
  }
  return problems;
}

// Settings that are fine on a laptop but unsafe or broken in production.
function productionProblems(e: z.infer<typeof schema>) {
  const problems: string[] = [];
  if (!e.SMTP_URL) problems.push("SMTP_URL is required: without it no email is actually sent.");
  if (!e.CLIENT_URL.startsWith("https://")) problems.push("CLIENT_URL must be the site's https:// address (links in emails and the session cookie depend on it).");
  if (/replace-with|change-me/i.test(e.JWT_SECRET)) problems.push("JWT_SECRET is still the example value. Generate a random one.");
  if (e.PAYMENT_PROVIDER === "fake") problems.push("PAYMENT_PROVIDER=fake is the local test gateway: it accepts payments without real money. Use razorpay or off.");
  return problems;
}

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:");
  console.error(z.prettifyError(parsed.error));
  process.exit(1);
}

const resolved = {
  ...parsed.data,
  PAYMENT_PROVIDER: parsed.data.PAYMENT_PROVIDER ?? (parsed.data.NODE_ENV === "production" ? "off" : "fake"),
};

const conflicts = configProblems(resolved);
if (conflicts.length) {
  console.error("Invalid environment variables:");
  conflicts.forEach((p) => console.error(` - ${p}`));
  process.exit(1);
}

if (resolved.NODE_ENV === "production") {
  const problems = productionProblems(resolved);
  if (problems.length) {
    console.error("Refusing to start in production:");
    problems.forEach((p) => console.error(` - ${p}`));
    process.exit(1);
  }
}

export const env = resolved;
