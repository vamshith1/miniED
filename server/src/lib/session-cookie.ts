import type { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

/**
 * The web app's session lives in an httpOnly cookie, so page scripts (and
 * any injected script) can't read the token. API clients can still send
 * "Authorization: Bearer <token>" instead.
 */
export const SESSION_COOKIE = "mecrm_session";

// Browsers send this on every request from the web app. Another website can't
// add a custom header to a cross-site request without CORS allowing it, so a
// cookie-authenticated write without it is rejected (CSRF protection).
export const CSRF_HEADER = "x-requested-with";
export const CSRF_VALUE = "miniedcrm";

const baseOptions = () => ({
  httpOnly: true,
  sameSite: "lax" as const, // not sent on cross-site POSTs, forms or fetches
  secure: env.NODE_ENV === "production", // HTTPS only in production
  path: "/api",
});

export function setSessionCookie(res: Response, token: string) {
  const exp = (jwt.decode(token) as { exp?: number } | null)?.exp;
  res.cookie(SESSION_COOKIE, token, { ...baseOptions(), ...(exp && { maxAge: exp * 1000 - Date.now() }) });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, baseOptions());
}

export function readSessionCookie(req: Request) {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === SESSION_COOKIE) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
