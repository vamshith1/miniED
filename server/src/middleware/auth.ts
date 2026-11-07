import type { RequestHandler } from "express";
import type { Role } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { verifyToken } from "../lib/jwt.js";
import { HttpError } from "../lib/http-error.js";

export type AuthUser = { id: string; name: string; email: string; role: Role; batchId: string | null };

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

// Reads "Authorization: Bearer <token>", verifies it and attaches req.user.
// The user is reloaded from the database so a deactivated account or a
// changed role takes effect immediately, not only when the token expires.
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) throw new HttpError(401, "Missing or malformed Authorization header");

  let userId: string;
  try {
    userId = verifyToken(header.slice(7)).sub;
  } catch {
    throw new HttpError(401, "Invalid or expired token");
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true, batchId: true, isActive: true },
  });
  if (!user || !user.isActive) throw new HttpError(401, "Account not found or deactivated");

  const { isActive: _, ...authUser } = user;
  req.user = authUser;
  next();
};

// Use after requireAuth: router.post("/", requireAuth, requireRole("ADMIN"), handler)
export const requireRole =
  (...roles: Role[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user) throw new HttpError(401, "Not authenticated");
    if (!roles.includes(req.user.role)) {
      throw new HttpError(403, `This action requires role: ${roles.join(" or ")}`);
    }
    next();
  };
