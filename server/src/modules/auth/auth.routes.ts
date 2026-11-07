import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { prisma } from "../../lib/prisma.js";
import { loginSchema, signupSchema } from "./auth.schemas.js";
import { createUser, issueSession, login, publicUserSelect } from "./auth.service.js";

export const authRouter = Router();

// POST /api/auth/signup: public signup always creates a STUDENT.
// Admin and mentor accounts are created by an admin via POST /api/users.
authRouter.post("/signup", async (req, res) => {
  const input = signupSchema.parse(req.body);
  const user = await createUser({ ...input, role: "STUDENT" });
  res.status(201).json(await issueSession(user.id));
});

// POST /api/auth/login → { token, user }
authRouter.post("/login", async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);
  res.json(await login(email, password));
});

// GET /api/auth/me: the logged-in user's profile
authRouter.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: publicUserSelect });
  res.json({ user });
});
