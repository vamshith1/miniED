import nodemailer from "nodemailer";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { env } from "../config/env.js";

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

// Where emails go when SMTP_URL isn't set: one .eml file per email,
// which you can open in any mail app.
export const OUTBOX_DIR = join(import.meta.dirname, "..", "..", ".outbox");

const smtp = env.SMTP_URL ? nodemailer.createTransport(env.SMTP_URL) : null;
const outbox = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" });

export const mailerName = () => (smtp ? "smtp" : "outbox");

/**
 * Sends one email. `id` (the EmailLog id) names the outbox file.
 * Throws on failure so the queue can retry.
 */
export async function sendMail(mail: Mail, id: string) {
  const message = { from: env.MAIL_FROM, ...mail };
  if (smtp) {
    await smtp.sendMail(message);
    return;
  }
  // Dev only: lets the smoke tests check that failed emails are retried.
  if (env.NODE_ENV !== "production" && mail.to.endsWith("@fail.test")) {
    throw new Error("Simulated delivery failure (@fail.test address)");
  }
  const info = await outbox.sendMail(message);
  await mkdir(OUTBOX_DIR, { recursive: true });
  await writeFile(join(OUTBOX_DIR, `${id}.eml`), info.message as Buffer);
}
