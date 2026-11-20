import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../lib/http-error.js";
import { signToken } from "../../lib/jwt.js";
import { DUMMY_HASH, hashPassword, verifyPassword } from "../../lib/password.js";
import type { CreateUserInput } from "./auth.schemas.js";

// Fields that are safe to return to the client (never passwordHash).
export const publicUserSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  phone: true,
  batchId: true,
  isActive: true,
  shareProfile: true,
  company: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

export async function createUser(input: CreateUserInput) {
  try {
    return await prisma.user.create({
      data: {
        name: input.name,
        email: input.email,
        phone: input.phone,
        role: input.role,
        company: input.role === "RECRUITER" ? input.company : null,
        passwordHash: await hashPassword(input.password),
      },
      select: publicUserSelect,
    });
  } catch (err) {
    // P2002 = unique constraint violation (the email is already taken)
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new HttpError(409, "An account with this email already exists");
    }
    throw err;
  }
}

export async function login(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email } });

  // Always run bcrypt, even when the user doesn't exist (see DUMMY_HASH).
  const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) throw new HttpError(401, "Invalid email or password");
  if (!user.isActive) throw new HttpError(403, "This account has been deactivated");

  return issueSession(user.id);
}

export async function issueSession(userId: string) {
  const { tokenVersion, ...user } = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { ...publicUserSelect, tokenVersion: true },
  });
  return { token: signToken({ sub: user.id, role: user.role, v: tokenVersion }), user };
}
