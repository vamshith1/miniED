import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../lib/http-error.js";
import type { AuthUser } from "../../middleware/auth.js";
import { assertCanManageBatch } from "../batches/batches.service.js";

// ---------- Input

// Only http(s) links, so a submission can never carry a javascript: URL.
const httpUrl = z
  .string()
  .trim()
  .max(500)
  .url()
  .refine((u) => /^https?:\/\//i.test(u), "Use a link starting with http:// or https://");

const taskFields = {
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(5000).nullish().transform((v) => v || null),
  dueAt: z.coerce.date().nullish().transform((v) => v ?? null),
  maxPoints: z.number().int().min(1).max(1000).nullish().transform((v) => v ?? null),
};

export const createTaskSchema = z.object({ ...taskFields, batchId: z.string().min(1) });
export const updateTaskSchema = z.object(taskFields).partial().refine((o) => Object.keys(o).length > 0, "Send at least one field to update");
export const listTasksQuery = z.object({ batchId: z.string().optional() });

export const submitSchema = z
  .object({
    link: httpUrl.nullish().transform((v) => v || null),
    note: z.string().trim().max(5000).nullish().transform((v) => v || null),
  })
  .refine((s) => s.link || s.note, "Add a link or a note");

export const reviewSchema = z.object({
  status: z.enum(["ACCEPTED", "CHANGES_REQUESTED"]),
  points: z.number().int().min(0).max(1000).nullish(),
  feedback: z.string().trim().max(5000).nullish().transform((v) => v || null),
});

// ---------- Access

async function getManagedTask(taskId: string, user: AuthUser) {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task || user.role === "STUDENT") throw new HttpError(404, "Task not found");
  await assertCanManageBatch(task.batchId, user);
  return task;
}

async function getStudentTask(taskId: string, user: AuthUser) {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task || task.batchId !== user.batchId) throw new HttpError(404, "Task not found");
  return task;
}

const isLate = (submittedAt: Date, dueAt: Date | null) => !!dueAt && submittedAt > dueAt;

// ---------- Managers

export async function createTask(input: z.infer<typeof createTaskSchema>, user: AuthUser) {
  await assertCanManageBatch(input.batchId, user);
  return prisma.task.create({ data: { ...input, createdById: user.id } });
}

export async function updateTask(taskId: string, input: z.infer<typeof updateTaskSchema>, user: AuthUser) {
  const task = await getManagedTask(taskId, user);
  if (input.maxPoints !== undefined && input.maxPoints !== task.maxPoints) {
    const graded = await prisma.taskSubmission.count({ where: { taskId, points: { not: null } } });
    if (graded > 0) throw new HttpError(409, "Some submissions already have points, so the maximum can't change");
  }
  return prisma.task.update({ where: { id: taskId }, data: input });
}

export async function deleteTask(taskId: string, user: AuthUser) {
  await getManagedTask(taskId, user);
  await prisma.task.delete({ where: { id: taskId } });
}

/** Mentors/admins: a batch's tasks with how many students have submitted. Students: their batch's tasks with their own submission. */
export async function listTasks(user: AuthUser, batchId?: string) {
  if (user.role === "STUDENT") {
    const tasks = await prisma.task.findMany({
      where: { batchId: user.batchId ?? "__none__" },
      orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
      include: { submissions: { where: { studentId: user.id }, include: { reviewedBy: { select: { name: true } } } } },
    });
    return tasks.map(({ submissions, ...t }) => {
      const s = submissions[0] ?? null;
      return { ...t, mySubmission: s && { ...s, late: isLate(s.submittedAt, t.dueAt) } };
    });
  }

  if (!batchId) throw new HttpError(400, "batchId is required");
  await assertCanManageBatch(batchId, user);
  const [tasks, students] = await Promise.all([
    prisma.task.findMany({
      where: { batchId },
      orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
      include: { submissions: { select: { status: true } }, createdBy: { select: { name: true } } },
    }),
    prisma.user.count({ where: { batchId, role: "STUDENT" } }),
  ]);
  return tasks.map(({ submissions, ...t }) => ({
    ...t,
    students,
    submitted: submissions.length,
    toReview: submissions.filter((s) => s.status === "SUBMITTED").length,
    accepted: submissions.filter((s) => s.status === "ACCEPTED").length,
  }));
}

/** Every student in the task's batch with their submission (or null). */
export async function listSubmissions(taskId: string, user: AuthUser) {
  const task = await getManagedTask(taskId, user);
  const [students, submissions] = await Promise.all([
    prisma.user.findMany({ where: { batchId: task.batchId, role: "STUDENT" }, select: { id: true, name: true, email: true }, orderBy: { name: "asc" } }),
    prisma.taskSubmission.findMany({ where: { taskId }, include: { reviewedBy: { select: { name: true } } } }),
  ]);
  const byStudent = new Map(submissions.map((s) => [s.studentId, s]));
  return {
    task,
    items: students.map((st) => {
      const s = byStudent.get(st.id);
      return { student: st, submission: s ? { ...s, late: isLate(s.submittedAt, task.dueAt) } : null };
    }),
  };
}

export async function reviewSubmission(taskId: string, submissionId: string, input: z.infer<typeof reviewSchema>, user: AuthUser) {
  const task = await getManagedTask(taskId, user);
  const sub = await prisma.taskSubmission.findUnique({ where: { id: submissionId } });
  if (!sub || sub.taskId !== taskId) throw new HttpError(404, "Submission not found");
  let points: number | null = null;
  if (input.points != null) {
    if (task.maxPoints == null) throw new HttpError(400, "This task isn't graded, so it takes no points");
    if (input.points > task.maxPoints) throw new HttpError(400, `Points can be at most ${task.maxPoints}`);
    points = input.points;
  }
  return prisma.taskSubmission.update({
    where: { id: submissionId },
    data: { status: input.status, points, feedback: input.feedback, reviewedAt: new Date(), reviewedById: user.id },
  });
}

// ---------- Students

/** Hands in (or replaces) the student's work. Accepted work is final. */
export async function submit(taskId: string, input: z.infer<typeof submitSchema>, user: AuthUser) {
  await getStudentTask(taskId, user);
  const existing = await prisma.taskSubmission.findUnique({ where: { taskId_studentId: { taskId, studentId: user.id } } });
  if (existing?.status === "ACCEPTED") throw new HttpError(409, "This work has already been accepted");
  const data: Prisma.TaskSubmissionUncheckedCreateInput = {
    taskId,
    studentId: user.id,
    link: input.link,
    note: input.note,
    status: "SUBMITTED",
    submittedAt: new Date(),
    points: null,
    reviewedAt: null,
  };
  return prisma.taskSubmission.upsert({
    where: { taskId_studentId: { taskId, studentId: user.id } },
    create: data,
    // Keep the mentor's last feedback visible until they review again.
    update: { link: data.link, note: data.note, status: "SUBMITTED", submittedAt: data.submittedAt, points: null, reviewedAt: null },
  });
}

// ---------- Used by the placement report

/** Per student: tasks set in their batch, handed in, accepted, and points. */
export async function taskStatsFor(batchId: string, studentIds: string[]) {
  const [tasks, subs] = await Promise.all([
    prisma.task.findMany({ where: { batchId }, select: { id: true, maxPoints: true, dueAt: true } }),
    prisma.taskSubmission.findMany({ where: { task: { batchId }, studentId: { in: studentIds } }, select: { studentId: true, status: true, submittedAt: true, task: { select: { dueAt: true } } } }),
  ]);
  const now = new Date();
  // Only tasks that are due (or have no due date) count against a student.
  const due = tasks.filter((t) => !t.dueAt || t.dueAt <= now).length;
  return new Map(
    studentIds.map((id) => {
      const mine = subs.filter((s) => s.studentId === id);
      return [
        id,
        {
          set: tasks.length,
          due,
          submitted: mine.length,
          accepted: mine.filter((s) => s.status === "ACCEPTED").length,
          late: mine.filter((s) => isLate(s.submittedAt, s.task.dueAt)).length,
        },
      ];
    }),
  );
}
