import { timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { env } from "../config/env.js";
import { HttpError } from "../lib/http-error.js";
import { enqueueEmail } from "../modules/emails/email.queue.js";
import { scanFollowUps } from "../modules/emails/follow-ups.js";

/**
 * Endpoints for an outside scheduler (a GitHub Action) to call. On free hosting
 * the app sleeps when idle, so its own 9:00 schedule can't be relied on: the
 * call wakes it and does the work. Protected by CRON_SECRET; with no secret
 * set, these routes don't exist.
 */
export const cronRouter = Router();

cronRouter.use((req, _res, next) => {
  if (!env.CRON_SECRET) throw new HttpError(404, `Route not found: ${req.method} ${req.originalUrl}`);
  const given = Buffer.from(String(req.headers["x-cron-secret"] ?? ""));
  const expected = Buffer.from(env.CRON_SECRET);
  // Constant-time comparison, so response timing doesn't leak the secret.
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new HttpError(401, "Wrong or missing X-Cron-Secret");
  next();
});

// POST /api/cron/follow-ups: same as the daily job. People already reminded today are skipped.
cronRouter.post("/follow-ups", async (_req, res) => {
  res.json(await scanFollowUps(enqueueEmail));
});
