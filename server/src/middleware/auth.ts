import type { RequestHandler } from "express";
import type { Role } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { verifyToken } from "../lib/jwt.js";
import { HttpError } from "../lib/http-error.js";
import { CSRF_HEADER, CSRF_VALUE, readSessionCookie } from "../lib/session-cookie.js";

export type AuthUser = { id: string; name: string; email: string; role: Role; batchId: string | null };

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Reads the session from "Authorization: Bearer <token>" (API clients) or the
// session cookie (the web app), verifies it and attaches req.user.
// The user is reloaded from the database so a deactivated account or a
// changed role takes effect immediately, not only when the token expires.
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const header = req.headers.authorization;
  let token: string | null = null;
  if (header?.startsWith("Bearer ")) {
    token = header.slice(7);
  } else {
    token = readSessionCookie(req);
    // Cookies are sent automatically, so writes must prove they came from our own pages.
    if (token && !SAFE_METHODS.has(req.method) && req.headers[CSRF_HEADER] !== CSRF_VALUE) {
      throw new HttpError(403, "Request blocked: missing X-Requested-With header");
    }
  }
  if (!token) throw new HttpError(401, "Not signed in");

  let userId: string;
  let version: number;
  try {
    const payload = verifyToken(token);
    userId = payload.sub;
    version = payload.v ?? 0; // tokens issued before tokenVersion existed count as version 0
  } catch {
    throw new HttpError(401, "Invalid or expired token");
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true, batchId: true, isActive: true, tokenVersion: true },
  });
  if (!user || !user.isActive) throw new HttpError(401, "Account not found or deactivated");
  // The password was changed or reset after this token was issued.
  if (user.tokenVersion !== version) throw new HttpError(401, "Your session has ended. Please sign in again.");

  const { isActive: _, tokenVersion: __, ...authUser } = user;
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
