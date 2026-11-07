import { Queue, Worker, UnrecoverableError, createPostgresBackend, type Job } from "bullmq";
import { Redis } from "ioredis";
import { env } from "../../config/env.js";
import { prisma } from "../../lib/prisma.js";
import { redis as cacheRedis } from "../../lib/cache.js";
import { mailerName, sendMail } from "../../lib/mailer.js";
import { PermanentEmailError, render, type EmailPayloads, type EmailTemplate } from "./email.templates.js";
import { scanFollowUps } from "./follow-ups.js";

/**
 * One BullMQ queue ("email") with two kinds of job:
 *  - "send":            send one email (EmailLog row = its id), retried with backoff
 *  - "follow-up-scan":  daily, queues one reminder email per person with leads due
 *
 * Backend: Redis when it's reachable (production), otherwise BullMQ's
 * Postgres backend in the app's own database, in a separate "bullmq" schema.
 * Either way jobs survive a restart.
 */
const QUEUE = "email";
const SCHEDULER_ID = "daily-lead-follow-ups";

type SendJob = { emailId: string; template: EmailTemplate; payload: EmailPayloads[EmailTemplate] };

type Backend = "redis" | "postgres";
let backend: Backend | null = null;
let queue: Queue | null = null;
let worker: Worker | null = null;
const redisClients: Redis[] = [];

export const queueBackendName = () => backend;

// Prisma's ?schema=public means something else to pg, so drop it.
function postgresConnection() {
  const url = new URL(env.DATABASE_URL);
  url.searchParams.delete("schema");
  return { connectionString: url.toString(), schema: "bullmq", migrate: true };
}

function pickBackend(): Backend {
  if (env.QUEUE_BACKEND === "redis") {
    if (!cacheRedis) throw new Error("QUEUE_BACKEND=redis but Redis isn't reachable");
    return "redis";
  }
  if (env.QUEUE_BACKEND === "postgres") return "postgres";
  return cacheRedis ? "redis" : "postgres";
}

// BullMQ classes take the backend as an optional third argument, so the rest
// of the file doesn't care which one is in use.
function build<T>(make: (opts: { connection: any }, factory?: any) => T, blocking: boolean): T {
  if (backend === "postgres") return make({ connection: postgresConnection() }, createPostgresBackend);
  // Workers block while waiting for jobs, so they need retries without a limit.
  const client = new Redis(env.REDIS_URL!, { maxRetriesPerRequest: blocking ? null : 1 });
  redisClients.push(client);
  return make({ connection: client });
}

const defaultJobOptions = {
  attempts: env.EMAIL_MAX_ATTEMPTS,
  backoff: { type: "exponential", delay: env.EMAIL_RETRY_DELAY_MS }, // 30s, 60s, 2m, 4m...
  removeOnComplete: { age: 24 * 3600 }, // EmailLog keeps the history
  removeOnFail: { age: 7 * 24 * 3600 },
};

// Call once at startup (after initCache, which finds out if Redis is up).
export async function initQueue() {
  backend = pickBackend();
  queue = build((o, f) => new Queue(QUEUE, { ...o, defaultJobOptions }, f), false);
  await queue.waitUntilReady();
  console.log(`Queue: ${backend}, email delivery: ${mailerName()}`);
}

function getQueue() {
  if (!queue) throw new Error("initQueue() hasn't been called");
  return queue;
}

/**
 * Records the email in EmailLog and queues it. Never throws: the action that
 * triggered the email (signup, conversion, quiz submit) has already succeeded,
 * and a mail problem shouldn't undo it. Check the returned status instead.
 */
export async function enqueueEmail<T extends EmailTemplate>(template: T, to: string, payload: EmailPayloads[T]) {
  const log = await prisma.emailLog.create({ data: { to, template } });
  try {
    const data: SendJob = { emailId: log.id, template, payload };
    const job = await getQueue().add("send", data, { jobId: log.id }); // jobId = EmailLog id, so it's queued once
    await prisma.emailLog.update({ where: { id: log.id }, data: { jobId: job.id } });
    return { id: log.id, status: "QUEUED" as const };
  } catch (err) {
    console.error(`Could not queue ${template} email to ${to}:`, err);
    await prisma.emailLog.update({
      where: { id: log.id },
      data: { status: "FAILED", lastError: `Could not queue: ${(err as Error).message}`.slice(0, 500) },
    });
    return { id: log.id, status: "FAILED" as const };
  }
}

async function processSend(job: Job<SendJob>) {
  const { emailId, template, payload } = job.data;
  const log = await prisma.emailLog.findUnique({ where: { id: emailId } });
  if (!log) throw new UnrecoverableError("EmailLog row is missing");
  if (log.status === "SENT") return; // already delivered (e.g. the worker crashed right after sending)

  const attempt = job.attemptsMade + 1; // attemptsMade = failed tries so far
  const maxAttempts = job.opts.attempts ?? 1;
  try {
    const mail = await render(template, payload);
    await sendMail({ to: log.to, ...mail }, log.id);
    // Reminders also go on each lead's timeline (skipping leads deleted since the scan).
    const leads =
      template === "lead-follow-up"
        ? await prisma.lead.findMany({
            where: { id: { in: (payload as EmailPayloads["lead-follow-up"]).leadIds } },
            select: { id: true },
          })
        : [];
    // Saved together, so a crash between them can't cause the email to be sent twice.
    await prisma.$transaction([
      prisma.emailLog.update({
        where: { id: log.id },
        data: { status: "SENT", attempts: attempt, sentAt: new Date(), lastError: null },
      }),
      prisma.leadActivity.createMany({
        data: leads.map((l) => ({ leadId: l.id, type: "REMINDER_SENT" as const, meta: { emailId: log.id, to: log.to } })),
      }),
    ]);
  } catch (err) {
    const permanent = err instanceof PermanentEmailError;
    const final = permanent || attempt >= maxAttempts;
    await prisma.emailLog.update({
      where: { id: log.id },
      data: { attempts: attempt, lastError: (err as Error).message.slice(0, 500), status: final ? "FAILED" : "QUEUED" },
    });
    if (final) console.error(`Email ${log.id} (${template} to ${log.to}) failed for good:`, (err as Error).message);
    throw permanent ? new UnrecoverableError((err as Error).message) : err;
  }
}

/**
 * Processes jobs and keeps the daily follow-up schedule registered.
 * Runs inside the API (RUN_WORKER=true) or on its own (`npm run worker`).
 */
export async function startWorker() {
  worker = build(
    (o, f) =>
      new Worker(
        QUEUE,
        async (job: Job) => {
          if (job.name === "send") return processSend(job as Job<SendJob>);
          if (job.name === "follow-up-scan") return scanFollowUps(enqueueEmail);
          throw new UnrecoverableError(`Unknown job ${job.name}`);
        },
        { ...o, concurrency: 5 },
        f,
      ),
    true,
  );
  worker.on("error", (err) => console.error("Email worker error:", err.message));
  await worker.waitUntilReady();

  // Idempotent: creates the schedule, or updates it if FOLLOW_UP_CRON changed.
  await getQueue().upsertJobScheduler(
    SCHEDULER_ID,
    { pattern: env.FOLLOW_UP_CRON, tz: Intl.DateTimeFormat().resolvedOptions().timeZone },
    { name: "follow-up-scan", opts: { attempts: 3, backoff: { type: "exponential", delay: 60_000 } } },
  );
  console.log(`Email worker started (follow-up reminders: "${env.FOLLOW_UP_CRON}")`);
}

export async function closeQueue() {
  await worker?.close();
  await queue?.close();
  redisClients.forEach((c) => c.disconnect());
}
