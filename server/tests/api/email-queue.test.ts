import { afterAll, describe, expect, it, vi } from "vitest";
import { closeQueue, initQueue, startWorker } from "../../src/modules/emails/email.queue.js";
import { prisma } from "../../src/lib/prisma.js";

afterAll(async () => {
  await closeQueue();
  await prisma.$disconnect();
});

const SCHEDULER = "daily-lead-follow-ups";

describe("email worker", () => {
  it("starts again after a restart, even if the last reminder run never finished cleanly", async () => {
    await initQueue();
    await startWorker();
    await closeQueue();

    // Recreate the state that used to crash startup: the scheduler still points at an
    // earlier run that is no longer waiting (the app stopped mid-scan), while the next
    // run is already queued. BullMQ's Postgres backend then reports "job ID already exists".
    const [{ next }] = await prisma.$queryRawUnsafe<{ next: bigint }[]>(
      `SELECT next_run_ms AS next FROM bullmq.scheduler WHERE scheduler_id = $1`,
      SCHEDULER,
    );
    const earlier = BigInt(next) - 86_400_000n;
    await prisma.$executeRawUnsafe(
      `INSERT INTO bullmq.job
         SELECT (jsonb_populate_record(NULL::bullmq.job, to_jsonb(j) || jsonb_build_object(
           'id', $2::text, 'state', 'completed', 'seq', (SELECT max(seq) + 1 FROM bullmq.job)))).*
         FROM bullmq.job j WHERE j.id = $1`,
      `repeat:${SCHEDULER}:${next}`,
      `repeat:${SCHEDULER}:${earlier}`,
    );
    await prisma.$executeRawUnsafe(`UPDATE bullmq.scheduler SET next_run_ms = $1 WHERE scheduler_id = $2`, earlier, SCHEDULER);

    const errors = vi.spyOn(console, "error");
    await initQueue();
    await expect(startWorker()).resolves.toBeUndefined();
    expect(errors.mock.calls.filter(([msg]) => String(msg).includes("follow-up reminders"))).toHaveLength(0);
    errors.mockRestore();
  });
});
