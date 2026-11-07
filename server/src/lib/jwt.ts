import jwt from "jsonwebtoken";
import type { Role } from "@prisma/client";
import { env } from "../config/env.js";

// v = the user's tokenVersion when the token was issued (see requireAuth).
export type TokenPayload = { sub: string; role: Role; v: number };

export function signToken(payload: TokenPayload) {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"],
  });
}

// Throws if the token is invalid, expired or signed with a different secret.
export function verifyToken(token: string) {
  return jwt.verify(token, env.JWT_SECRET) as TokenPayload & jwt.JwtPayload;
}
