import type { Request, RequestHandler } from "express";
import { env } from "../config/env.js";
import { redis } from "../lib/cache.js";

/**
 * Fixed-window rate limiting: at most `max` requests per `windowMs` for each key.
 * Counts live in Redis when it's connected (shared by every server), otherwise
 * in this process's memory, which is fine for a single server.
 */
interface Options {
  name: string; // keeps each limit's counters separate
  windowMs: number;
  max: number;
  key?: (req: Request) => string; // default: the client's IP
  message?: string;
}

interface Hit {
  count: number;
  resetAt: number;
}

const memory = new Map<string, Hit>();
// Drop expired windows now and then so memory doesn't grow forever.
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of memory) if (v.resetAt <= now) memory.delete(k);
}, 60_000).unref();

async function hit(key: string, windowMs: number): Promise<Hit> {
  if (redis) {
    const count = await redis.incr(key);
    if (count === 1) await redis.pexpire(key, windowMs);
    let ttl = await redis.pttl(key);
    if (ttl < 0) {
      // The expiry was lost (e.g. a crash between the two calls): set it again.
      await redis.pexpire(key, windowMs);
      ttl = windowMs;
    }
    return { count, resetAt: Date.now() + ttl };
  }
  const now = Date.now();
  const current = memory.get(key);
  if (!current || current.resetAt <= now) {
    const fresh = { count: 1, resetAt: now + windowMs };
    memory.set(key, fresh);
    return fresh;
  }
  current.count++;
  return current;
}

const isLocal = (ip = "") => ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";

// In development, requests from this machine skip the limits so smoke tests and
// local clicking aren't blocked. RATE_LIMIT_LOCAL=true turns them on for testing.
const skip = (req: Request) => env.NODE_ENV !== "production" && !env.RATE_LIMIT_LOCAL && isLocal(req.ip);

const humanWait = (ms: number) => {
  const min = Math.ceil(ms / 60_000);
  return min <= 1 ? "a minute" : `${min} minutes`;
};

export function rateLimit({ name, windowMs, max, key, message }: Options): RequestHandler {
  return async (req, res, next) => {
    if (skip(req)) return next();
    let result: Hit;
    try {
      result = await hit(`rl:${name}:${key ? key(req) : req.ip}`, windowMs);
    } catch (err) {
      // A broken limiter store shouldn't take the whole API down.
      console.error(`Rate limit "${name}" store failed, allowing the request:`, err);
      return next();
    }
    const waitMs = Math.max(0, result.resetAt - Date.now());
    res.setHeader("RateLimit-Limit", max);
    res.setHeader("RateLimit-Remaining", Math.max(0, max - result.count));
    res.setHeader("RateLimit-Reset", Math.ceil(waitMs / 1000));
    if (result.count > max) {
      res.setHeader("Retry-After", Math.ceil(waitMs / 1000));
      res.status(429).json({ error: message ?? `Too many requests. Try again in ${humanWait(waitMs)}.` });
      return;
    }
    next();
  };
}

const MIN = 60_000;
const emailKey = (req: Request) => `${req.ip}:${String(req.body?.email ?? "").trim().toLowerCase()}`;

// The limits, all in one place.
export const limits = {
  // Every API request, per IP: stops scripted floods without bothering real users.
  api: rateLimit({ name: "api", windowMs: MIN, max: 300 }),
  // Login per IP + email: password guessing gets 10 tries per 15 minutes...
  login: rateLimit({ name: "login", windowMs: 15 * MIN, max: 10, key: emailKey, message: "Too many sign-in attempts. Wait 15 minutes, or reset your password." }),
  // ...and per IP, so one machine can't try many accounts.
  loginIp: rateLimit({ name: "login-ip", windowMs: 15 * MIN, max: 50 }),
  signup: rateLimit({ name: "signup", windowMs: 60 * MIN, max: 10 }),
  passwordReset: rateLimit({ name: "password-reset", windowMs: 60 * MIN, max: 10 }),
  changePassword: rateLimit({ name: "change-password", windowMs: 15 * MIN, max: 10, key: (req) => req.user?.id ?? req.ip ?? "" }),
  upload: rateLimit({ name: "upload", windowMs: 60 * MIN, max: 30, key: (req) => req.user?.id ?? req.ip ?? "" }),
  csvImport: rateLimit({ name: "csv-import", windowMs: 60 * MIN, max: 20, key: (req) => req.user?.id ?? req.ip ?? "" }),
  // Creating payment orders, per admin: each one is a call to the gateway.
  paymentOrder: rateLimit({ name: "payment-order", windowMs: 60 * MIN, max: 60, key: (req) => req.user?.id ?? req.ip ?? "" }),
  // Quiz submits per student. Each quiz only scores once, so real use is a handful an hour;
  // this stops scripts hammering the grader (and the leaderboard cache it clears).
  quizSubmit: rateLimit({
    name: "quiz-submit",
    windowMs: 10 * MIN,
    max: 20,
    key: (req) => req.user?.id ?? req.ip ?? "",
    message: "Too many quiz submissions. Wait a few minutes and try again.",
  }),
};
