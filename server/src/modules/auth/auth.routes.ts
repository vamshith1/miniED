import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { prisma } from "../../lib/prisma.js";
import { changePasswordSchema, forgotPasswordSchema, loginSchema, resetPasswordSchema, signupSchema } from "./auth.schemas.js";
import { changePassword, checkResetToken, requestPasswordReset, resetPassword } from "./password.service.js";
import { z } from "zod";
import { createUser, issueSession, login, publicUserSelect } from "./auth.service.js";
import { enqueueEmail } from "../emails/email.queue.js";

export const authRouter = Router();

// POST /api/auth/signup: public signup always creates a STUDENT.
// Admin and mentor accounts are created by an admin via POST /api/users.
authRouter.post("/signup", async (req, res) => {
  const input = signupSchema.parse(req.body);
  const user = await createUser({ ...input, role: "STUDENT" });
  await enqueueEmail("welcome", user.email, { userId: user.id });
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

// POST /api/auth/change-password { currentPassword, newPassword } → a new { token, user }.
// Every other session (other devices) is signed out.
authRouter.post("/change-password", requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
  res.json(await changePassword(req.user!.id, currentPassword, newPassword));
});

// POST /api/auth/forgot-password { email }. Same answer whether or not the email exists.
authRouter.post("/forgot-password", async (req, res) => {
  const { email } = forgotPasswordSchema.parse(req.body);
  await requestPasswordReset(email);
  res.json({ message: "If that email has an account, a reset link is on its way. It works for 1 hour." });
});

// GET /api/auth/reset-password?token=  → 200 { email } if the link still works, else 400
authRouter.get("/reset-password", async (req, res) => {
  const { token } = z.object({ token: z.string().min(20).max(200) }).parse(req.query);
  res.json(await checkResetToken(token));
});

// POST /api/auth/reset-password { token, newPassword }. Signs out every existing session.
authRouter.post("/reset-password", async (req, res) => {
  const { token, newPassword } = resetPasswordSchema.parse(req.body);
  await resetPassword(token, newPassword);
  res.json({ message: "Password updated. Sign in with your new password." });
});
