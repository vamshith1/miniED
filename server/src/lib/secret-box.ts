import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "../config/env.js";

/**
 * Encrypts short secrets (like a temporary password) before they're stored
 * in a queued job, so they never sit in Redis or Postgres as plain text.
 * AES-256-GCM with a key derived from JWT_SECRET. Output: iv.tag.data (base64url).
 */
const key = createHash("sha256").update(`secret-box:${env.JWT_SECRET}`).digest();

export function seal(plain: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
}

export function open(sealed: string) {
  const [iv, tag, data] = sealed.split(".").map((p) => Buffer.from(p, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
