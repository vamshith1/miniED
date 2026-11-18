import request from "supertest";
import type { Express } from "express";
import type { Role } from "@prisma/client";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { hashPassword } from "../src/lib/password.js";
import { closeQueue, initQueue } from "../src/modules/emails/email.queue.js";

let app: Express | null = null;
let queueReady: Promise<void> | null = null;

/** The Express app, with the email queue ready (jobs are stored, never sent: RUN_WORKER=false). */
export async function getApp() {
  queueReady ??= initQueue();
  await queueReady;
  return (app ??= createApp());
}

export async function closeApp() {
  await closeQueue();
  await prisma.$disconnect();
}

let counter = 0;
/** A unique email for this run, so tests never collide. */
export const uniqueEmail = (tag: string) => `${tag}.${Date.now()}.${++counter}@test.miniedcrm`;

export const PASSWORD = "Test@12345";

/** Creates a user straight in the database and signs in through the API. */
export async function createUser(role: Role, overrides: { name?: string; email?: string; batchId?: string } = {}) {
  const email = overrides.email ?? uniqueEmail(role.toLowerCase());
  await prisma.user.create({
    data: {
      name: overrides.name ?? `Test ${role}`,
      email,
      role,
      passwordHash: await hashPassword(PASSWORD),
      batchId: overrides.batchId,
    },
  });
  return login(email, PASSWORD);
}

export async function login(email: string, password: string) {
  const res = await request(await getApp()).post("/api/auth/login").send({ email, password });
  if (res.status !== 200) throw new Error(`Login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return { token: res.body.token as string, user: res.body.user as { id: string; email: string; role: Role } };
}

/** Request helpers that sign in with a Bearer token. */
export function as(token: string | null) {
  const withAuth = (t: request.Test) => (token ? t.set("Authorization", `Bearer ${token}`) : t);
  return {
    get: async (path: string) => withAuth(request(await getApp()).get(`/api${path}`)),
    post: async (path: string, body?: object) => withAuth(request(await getApp()).post(`/api${path}`)).send(body),
    put: async (path: string, body?: object) => withAuth(request(await getApp()).put(`/api${path}`)).send(body),
    patch: async (path: string, body?: object) => withAuth(request(await getApp()).patch(`/api${path}`)).send(body),
    delete: async (path: string) => withAuth(request(await getApp()).delete(`/api${path}`)),
    upload: async (path: string, file: Buffer, filename: string, fields: Record<string, string> = {}) => {
      let t = withAuth(request(await getApp()).post(`/api${path}`));
      for (const [k, v] of Object.entries(fields)) t = t.field(k, v);
      return t.attach("file", file, filename);
    },
  };
}

/** YYYY-MM-DD on the server's clock, `offset` days from today. */
export const ymd = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toLocaleDateString("en-CA");
};
