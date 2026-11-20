import { randomInt } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../lib/http-error.js";
import { toDbDate } from "../../lib/dates.js";
import type { AuthUser } from "../../middleware/auth.js";
import type { z } from "zod";
import type { createBatchSchema, updateBatchSchema } from "./batches.schemas.js";

const batchInclude = {
  mentor: { select: { id: true, name: true, email: true } },
  _count: { select: { students: true } },
} satisfies Prisma.BatchInclude;

// Who may see a batch: any admin, the batch's mentor, or a student in it.
// Everyone else gets 404, not 403, so batch ids can't be probed.
export async function getBatchForUser(batchId: string, user: AuthUser) {
  const batch = await prisma.batch.findUnique({ where: { id: batchId }, include: batchInclude });
  const allowed =
    batch &&
    (user.role === "ADMIN" ||
      (user.role === "MENTOR" && batch.mentorId === user.id) ||
      (user.role === "STUDENT" && user.batchId === batch.id));
  if (!allowed) throw new HttpError(404, "Batch not found");
  return forViewer(batch, user);
}

// The join code is for the institute to hand out, so students never get it back from the API.
function forViewer<T extends { joinCode: string | null }>(batch: T, user: AuthUser): T {
  return user.role === "STUDENT" ? { ...batch, joinCode: null } : batch;
}

// 8 characters without look-alikes (no 0/O, 1/I/L), e.g. "K7RM-4QXP" is shown with a dash.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const newCode = () => Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
export const normalizeCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Makes a fresh join code (the old one stops working), or turns joining by code off. */
export async function setJoinCode(batchId: string, user: AuthUser, enabled: boolean) {
  await assertCanManageBatch(batchId, user);
  for (let tries = 0; ; tries++) {
    try {
      return await prisma.batch.update({ where: { id: batchId }, data: { joinCode: enabled ? newCode() : null }, include: batchInclude });
    } catch (err) {
      // A clash with another batch's code: astronomically rare, so just draw again.
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") || tries >= 3) throw err;
    }
  }
}

/** A student who isn't in a batch joins one with its code. */
export async function joinWithCode(code: string, user: AuthUser) {
  if (user.batchId) throw new HttpError(409, "You're already in a batch. Ask the institute if you need to move.");
  const batch = await prisma.batch.findUnique({ where: { joinCode: normalizeCode(code) }, select: { id: true, name: true, endDate: true } });
  if (!batch) throw new HttpError(404, "That code doesn't match any batch. Check it with your institute.");
  if (batch.endDate && batch.endDate < new Date(new Date().toISOString().slice(0, 10))) throw new HttpError(409, "That batch has already finished.");
  await prisma.user.update({ where: { id: user.id }, data: { batchId: batch.id } });
  return { batchId: batch.id, batchName: batch.name };
}

// Admins, plus the mentor of this batch, can manage its day-to-day work
// (attendance, quizzes).
export async function assertCanManageBatch(batchId: string, user: AuthUser) {
  const batch = await getBatchForUser(batchId, user);
  if (user.role === "STUDENT") throw new HttpError(403, "Only the batch mentor or an admin can do this");
  return batch;
}

async function assertMentor(userId: string) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, isActive: true } });
  if (!u || !u.isActive || u.role !== "MENTOR") throw new HttpError(400, "mentorId must be an active mentor");
}

function uniqueNameError(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    throw new HttpError(409, "A batch with this name already exists");
  }
  throw err;
}

export async function createBatch(input: z.infer<typeof createBatchSchema>) {
  if (input.mentorId) await assertMentor(input.mentorId);
  return prisma.batch
    .create({
      data: {
        ...input,
        startDate: toDbDate(input.startDate),
        endDate: input.endDate ? toDbDate(input.endDate) : undefined,
      },
      include: batchInclude,
    })
    .catch(uniqueNameError);
}

export async function updateBatch(id: string, input: z.infer<typeof updateBatchSchema>) {
  const batch = await prisma.batch.findUnique({ where: { id } });
  if (!batch) throw new HttpError(404, "Batch not found");
  if (input.mentorId) await assertMentor(input.mentorId);

  const start = input.startDate ?? batch.startDate.toISOString().slice(0, 10);
  const end = input.endDate === undefined ? batch.endDate?.toISOString().slice(0, 10) : input.endDate;
  if (end && end < start) throw new HttpError(400, "endDate must be on or after startDate");

  return prisma.batch
    .update({
      where: { id },
      data: {
        ...input,
        startDate: input.startDate ? toDbDate(input.startDate) : undefined,
        endDate: input.endDate === undefined ? undefined : input.endDate ? toDbDate(input.endDate) : null,
      },
      include: batchInclude,
    })
    .catch(uniqueNameError);
}

export async function listBatchesForUser(user: AuthUser) {
  const where: Prisma.BatchWhereInput =
    user.role === "ADMIN"
      ? {}
      : user.role === "MENTOR"
        ? { mentorId: user.id }
        : { id: user.batchId ?? "__none__" };
  const items = await prisma.batch.findMany({ where, include: batchInclude, orderBy: { startDate: "desc" } });
  return items.map((b) => forViewer(b, user));
}

export async function listStudents(batchId: string) {
  return prisma.user.findMany({
    where: { batchId, role: "STUDENT" },
    select: { id: true, name: true, email: true, phone: true, isActive: true, createdAt: true },
    orderBy: { name: "asc" },
  });
}

// Puts an existing student into this batch (or moves them from another one).
export async function addStudent(batchId: string, studentId: string) {
  const [batch, student] = await Promise.all([
    prisma.batch.findUnique({ where: { id: batchId }, select: { id: true } }),
    prisma.user.findUnique({ where: { id: studentId }, select: { role: true } }),
  ]);
  if (!batch) throw new HttpError(404, "Batch not found");
  if (!student || student.role !== "STUDENT") throw new HttpError(400, "studentId must be a student");
  return prisma.user.update({
    where: { id: studentId },
    data: { batchId },
    select: { id: true, name: true, email: true, batchId: true },
  });
}

export async function removeStudent(batchId: string, studentId: string) {
  const { count } = await prisma.user.updateMany({ where: { id: studentId, batchId }, data: { batchId: null } });
  if (count === 0) throw new HttpError(404, "That student isn't in this batch");
}
