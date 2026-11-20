import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../lib/http-error.js";
import type { AuthUser } from "../../middleware/auth.js";
import { assertCanManageBatch } from "../batches/batches.service.js";
import { skillsFor } from "../progress/skills.js";
import { toCsv } from "../../lib/csv.js";

/**
 * Placement readiness: one 0–100 score per student, from
 *   quizzes    50%  average test score (an expired attempt counts as 0)
 *   attendance 30%  days attended (late counts as attended)
 *   tasks      20%  tasks accepted, out of those already due
 * A part with no data yet (no tests taken, nothing marked, no tasks due) is left out
 * and the others are weighed up to 100%, so a new student isn't marked down for it.
 * With no data at all the score is null.
 */
export const WEIGHTS = { quizzes: 50, attendance: 30, tasks: 20 } as const;

export type Band = "READY" | "ALMOST" | "NEEDS_WORK";
export const bandOf = (score: number): Band => (score >= 75 ? "READY" : score >= 50 ? "ALMOST" : "NEEDS_WORK");

const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : null);

export function readinessScore(parts: { quizzes: number | null; attendance: number | null; tasks: number | null }) {
  let total = 0;
  let weight = 0;
  for (const key of Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[]) {
    const v = parts[key];
    if (v == null) continue;
    total += v * WEIGHTS[key];
    weight += WEIGHTS[key];
  }
  return weight ? Math.round((total / weight) * 10) / 10 : null;
}

type StudentRef = { id: string; batchId: string | null };

/** Readiness, its parts and skill gaps for each student. */
export async function readinessFor(students: StudentRef[]) {
  const ids = students.map((s) => s.id);
  const batchIds = [...new Set(students.map((s) => s.batchId).filter((b): b is string => !!b))];
  const now = new Date();

  const [quiz, attendance, dueTasks, accepted, skills] = await Promise.all([
    prisma.quizAttempt.groupBy({
      by: ["studentId"],
      where: { studentId: { in: ids }, status: { in: ["SUBMITTED", "EXPIRED"] } },
      _sum: { score: true, maxScore: true },
      _count: { _all: true },
    }),
    prisma.attendance.groupBy({ by: ["studentId", "status"], where: { studentId: { in: ids } }, _count: { _all: true } }),
    prisma.task.groupBy({ by: ["batchId"], where: { batchId: { in: batchIds }, OR: [{ dueAt: null }, { dueAt: { lte: now } }] }, _count: { _all: true } }),
    prisma.taskSubmission.groupBy({
      by: ["studentId"],
      where: { studentId: { in: ids }, status: "ACCEPTED", task: { OR: [{ dueAt: null }, { dueAt: { lte: now } }] } },
      _count: { _all: true },
    }),
    skillsFor(ids),
  ]);

  const quizBy = new Map(quiz.map((q) => [q.studentId, q]));
  const dueBy = new Map(dueTasks.map((t) => [t.batchId, t._count._all]));
  const acceptedBy = new Map(accepted.map((a) => [a.studentId, a._count._all]));
  const att = new Map<string, { attended: number; total: number }>();
  for (const a of attendance) {
    const t = att.get(a.studentId) ?? { attended: 0, total: 0 };
    t.total += a._count._all;
    if (a.status !== "ABSENT") t.attended += a._count._all;
    att.set(a.studentId, t);
  }

  return new Map(
    students.map((s) => {
      const q = quizBy.get(s.id);
      const a = att.get(s.id);
      const due = s.batchId ? (dueBy.get(s.batchId) ?? 0) : 0;
      const done = Math.min(acceptedBy.get(s.id) ?? 0, due);
      const parts = {
        quizzes: q ? pct(q._sum.score ?? 0, q._sum.maxScore ?? 0) : null,
        attendance: a ? pct(a.attended, a.total) : null,
        tasks: due ? pct(done, due) : null,
      };
      const score = readinessScore(parts);
      const sk = skills.get(s.id) ?? [];
      return [
        s.id,
        {
          readiness: score,
          band: score == null ? null : bandOf(score),
          quizAverage: parts.quizzes,
          quizzesTaken: q?._count._all ?? 0,
          attendance: parts.attendance,
          daysMarked: a?.total ?? 0,
          tasksDue: due,
          tasksAccepted: done,
          taskCompletion: parts.tasks,
          gaps: sk.filter((x) => x.level === "GAP").map((x) => x.skill),
          strengths: sk.filter((x) => x.level === "STRONG").map((x) => x.skill),
        },
      ];
    }),
  );
}

/** A batch's placement view: every student, best prepared first, plus a summary. */
export async function batchPlacement(batchId: string, user: AuthUser) {
  const batch = await assertCanManageBatch(batchId, user);
  const students = await prisma.user.findMany({
    where: { batchId, role: "STUDENT" },
    select: { id: true, name: true, email: true, isActive: true, batchId: true },
    orderBy: { name: "asc" },
  });
  const r = await readinessFor(students);
  const rows = students
    .map((s) => ({ student: { id: s.id, name: s.name, email: s.email, isActive: s.isActive }, ...r.get(s.id)! }))
    .sort((a, b) => (b.readiness ?? -1) - (a.readiness ?? -1));

  const scored = rows.filter((x) => x.readiness != null);
  const gapCounts = new Map<string, number>();
  for (const row of rows) for (const g of row.gaps) gapCounts.set(g, (gapCounts.get(g) ?? 0) + 1);

  return {
    batch: { id: batch.id, name: batch.name, course: batch.course },
    weights: WEIGHTS,
    summary: {
      students: rows.length,
      scored: scored.length,
      averageReadiness: scored.length ? Math.round((scored.reduce((s, x) => s + x.readiness!, 0) / scored.length) * 10) / 10 : null,
      ready: rows.filter((x) => x.band === "READY").length,
      almost: rows.filter((x) => x.band === "ALMOST").length,
      needsWork: rows.filter((x) => x.band === "NEEDS_WORK").length,
      // The skills most students struggle with: what to teach next.
      topGaps: [...gapCounts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 8)
        .map(([skill, students]) => ({ skill, students })),
    },
    items: rows,
  };
}

const bandLabel: Record<Band, string> = { READY: "Ready", ALMOST: "Almost ready", NEEDS_WORK: "Needs work" };
const num = (v: number | null) => (v == null ? "" : v);

export async function batchPlacementCsv(batchId: string, user: AuthUser) {
  const p = await batchPlacement(batchId, user);
  const csv = toCsv(
    ["Student", "Email", "Readiness (%)", "Status", "Quiz average (%)", "Quizzes taken", "Attendance (%)", "Days marked", "Tasks accepted", "Tasks due", "Skill gaps", "Strengths"],
    p.items.map((x) => [
      x.student.name,
      x.student.email,
      num(x.readiness),
      x.band ? bandLabel[x.band] : "No data yet",
      num(x.quizAverage),
      x.quizzesTaken,
      num(x.attendance),
      x.daysMarked,
      x.tasksAccepted,
      x.tasksDue,
      x.gaps.join("; "),
      x.strengths.join("; "),
    ]),
  );
  return { csv, batchName: p.batch.name };
}

/** Admins: one row per batch, for the institute-wide view. Mentors: their own batches. */
export async function overview(user: AuthUser) {
  if (user.role === "STUDENT") throw new HttpError(403, "Not allowed");
  const batches = await prisma.batch.findMany({
    where: user.role === "MENTOR" ? { mentorId: user.id } : {},
    select: { id: true, name: true, course: true, startDate: true, endDate: true, students: { where: { role: "STUDENT" }, select: { id: true, batchId: true } } },
    orderBy: { startDate: "desc" },
  });
  const r = await readinessFor(batches.flatMap((b) => b.students));
  return {
    items: batches.map((b) => {
      const rows = b.students.map((s) => r.get(s.id)!);
      const scored = rows.filter((x) => x.readiness != null);
      return {
        id: b.id,
        name: b.name,
        course: b.course,
        students: rows.length,
        averageReadiness: scored.length ? Math.round((scored.reduce((s, x) => s + x.readiness!, 0) / scored.length) * 10) / 10 : null,
        ready: rows.filter((x) => x.band === "READY").length,
        almost: rows.filter((x) => x.band === "ALMOST").length,
        needsWork: rows.filter((x) => x.band === "NEEDS_WORK").length,
      };
    }),
  };
}

/** A student's own readiness. */
export async function myReadiness(user: AuthUser) {
  const r = (await readinessFor([{ id: user.id, batchId: user.batchId }])).get(user.id)!;
  return { weights: WEIGHTS, ...r };
}
