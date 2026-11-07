import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { prisma } from "../../lib/prisma.js";
import { paginated, paginationQuery, toSkipTake } from "../../lib/pagination.js";
import { HttpError } from "../../lib/http-error.js";
import { enqueueEmail } from "./email.queue.js";
import { scanFollowUps } from "./follow-ups.js";
import { TEMPLATES } from "./email.templates.js";

export const emailsRouter = Router();
emailsRouter.use(requireAuth, requireRole("ADMIN"));

const listQuery = paginationQuery.extend({
  status: z.enum(["QUEUED", "SENT", "FAILED"]).optional(),
  template: z.enum(TEMPLATES).optional(),
  to: z.string().trim().toLowerCase().optional(),
});

// GET /api/emails?status=FAILED&template=welcome&to=a@b.com: the email log, newest first
emailsRouter.get("/", async (req, res) => {
  const q = listQuery.parse(req.query);
  const where = {
    ...(q.status && { status: q.status }),
    ...(q.template && { template: q.template }),
    ...(q.to && { to: q.to }),
  };
  const [items, total] = await prisma.$transaction([
    prisma.emailLog.findMany({ where, orderBy: { createdAt: "desc" }, ...toSkipTake(q) }),
    prisma.emailLog.count({ where }),
  ]);
  res.json(paginated(items, total, q));
});

// GET /api/emails/:id
emailsRouter.get("/:id", async (req, res) => {
  const email = await prisma.emailLog.findUnique({ where: { id: req.params.id } });
  if (!email) throw new HttpError(404, "Email not found");
  res.json({ email });
});

// POST /api/emails/follow-ups/run: send today's follow-up reminders now
// (the same thing the daily job does; people already reminded today are skipped).
emailsRouter.post("/follow-ups/run", async (_req, res) => {
  res.json(await scanFollowUps(enqueueEmail));
});
