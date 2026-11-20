import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../lib/http-error.js";
import { createUserSchema } from "../auth/auth.schemas.js";
import { createUser, publicUserSelect } from "../auth/auth.service.js";
import { enqueueEmail } from "../emails/email.queue.js";

export const usersRouter = Router();

// Every route in this file is admin-only.
usersRouter.use(requireAuth, requireRole("ADMIN"));

// POST /api/users: create an admin, mentor or student
usersRouter.post("/", async (req, res) => {
  const user = await createUser(createUserSchema.parse(req.body));
  const welcomeEmail = await enqueueEmail("welcome", user.email, { userId: user.id });
  res.status(201).json({ user, welcomeEmail });
});

// GET /api/users?role=MENTOR&page=1&limit=20
const listQuery = z.object({
  role: z.enum(["ADMIN", "MENTOR", "STUDENT", "RECRUITER"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

usersRouter.get("/", async (req, res) => {
  const { role, page, limit } = listQuery.parse(req.query);
  const where = role ? { role } : {};
  const [items, total] = await prisma.$transaction([
    prisma.user.findMany({
      where,
      select: publicUserSelect,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.user.count({ where }),
  ]);
  res.json({ items, page, limit, total, totalPages: Math.ceil(total / limit) });
});

// PATCH /api/users/:id/status { isActive: false } to deactivate an account
usersRouter.patch("/:id/status", async (req, res) => {
  const { isActive } = z.object({ isActive: z.boolean() }).parse(req.body);
  if (req.params.id === req.user!.id && !isActive) throw new HttpError(400, "You cannot deactivate your own account");
  const user = await prisma.user
    .update({ where: { id: req.params.id }, data: { isActive }, select: publicUserSelect })
    .catch(() => {
      throw new HttpError(404, "User not found");
    });
  res.json({ user });
});
