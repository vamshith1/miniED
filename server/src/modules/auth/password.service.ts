import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../lib/http-error.js";
import { hashPassword, verifyPassword } from "../../lib/password.js";
import { seal } from "../../lib/secret-box.js";
import { enqueueEmail } from "../emails/email.queue.js";
import { issueSession } from "./auth.service.js";

const RESET_TTL_MS = 60 * 60 * 1000; // reset links work for 1 hour
const RESEND_GAP_MS = 60 * 1000; // at most one reset email per minute per person

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * Signed-in user changes their own password. Every other session is signed
 * out (tokenVersion bumps), and this one gets a fresh token so it stays in.
 */
export async function changePassword(userId: string, currentPassword: string, newPassword: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw new HttpError(400, "Your current password is wrong", { currentPassword: ["Your current password is wrong"] });
  }
  if (currentPassword === newPassword) {
    throw new HttpError(400, "Choose a password you haven't used here", { newPassword: ["Must be different from the current password"] });
  }
  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(newPassword), tokenVersion: { increment: 1 } },
    }),
    // Any reset link still lying in their inbox stops working too.
    prisma.passwordResetToken.deleteMany({ where: { userId, usedAt: null } }),
  ]);
  await enqueueEmail("password-changed", user.email, { userId, how: "changed" });
  return issueSession(userId);
}

/**
 * "Forgot password". Always looks the same to the caller, whether or not the
 * email exists, so it can't be used to find out who has an account.
 */
export async function requestPasswordReset(email: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive) return;

  const recent = await prisma.passwordResetToken.findFirst({
    where: { userId: user.id, createdAt: { gte: new Date(Date.now() - RESEND_GAP_MS) } },
  });
  if (recent) return; // a link was sent moments ago; don't flood their inbox

  const token = randomBytes(32).toString("base64url");
  await prisma.$transaction([
    // Only the newest link works.
    prisma.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } }),
    prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) },
    }),
  ]);
  // The raw token exists only in the email (and encrypted in the queued job).
  await enqueueEmail("password-reset", user.email, { userId: user.id, sealedToken: seal(token) });
}

async function findUsableToken(token: string) {
  const row = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: { select: { id: true, email: true, isActive: true } } },
  });
  if (!row || row.usedAt || row.expiresAt < new Date() || !row.user.isActive) {
    throw new HttpError(400, "This reset link is invalid or has expired. Ask for a new one.");
  }
  return row;
}

// Lets the reset page say "link expired" before the user types a new password.
export async function checkResetToken(token: string) {
  const row = await findUsableToken(token);
  return { email: row.user.email, expiresAt: row.expiresAt };
}

export async function resetPassword(token: string, newPassword: string) {
  const row = await findUsableToken(token);
  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction(async (tx) => {
    // Guarded update: if two requests use the same link at once, only one wins.
    const { count } = await tx.passwordResetToken.updateMany({
      where: { id: row.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (count === 0) throw new HttpError(400, "This reset link has already been used.");
    await tx.user.update({ where: { id: row.userId }, data: { passwordHash, tokenVersion: { increment: 1 } } });
    await tx.passwordResetToken.deleteMany({ where: { userId: row.userId, usedAt: null } });
  });
  await enqueueEmail("password-changed", row.user.email, { userId: row.userId, how: "reset" });
}
