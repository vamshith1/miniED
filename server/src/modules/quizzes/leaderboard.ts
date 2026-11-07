import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../lib/http-error.js";
import { cacheKeys, getOrSet } from "../../lib/cache.js";
import type { AuthUser } from "../../middleware/auth.js";
import { getBatchForUser } from "../batches/batches.service.js";
import { getManagedQuiz, getStudentQuiz } from "./quizzes.service.js";

// Cached for 5 minutes. A new submission clears it right away (see
// submitAttempt), so the TTL is only a safety net.
const TTL_SECONDS = 300;

type Ranked<T> = T & { rank: number };

// Competition ranking: equal entries share a rank and the next rank is
// skipped (1, 2, 2, 4).
export function rank<T>(rows: T[], same: (a: T, b: T) => boolean): Ranked<T>[] {
  return rows.map((row, i) => {
    let r = i + 1;
    let j = i;
    while (j > 0 && same(rows[j - 1], row)) r = j--;
    return { ...row, rank: r };
  });
}

// Higher score first; faster time breaks ties.
export async function getQuizLeaderboard(quizId: string, user: AuthUser) {
  const quiz = user.role === "STUDENT" ? await getStudentQuiz(quizId, user) : await getManagedQuiz(quizId, user);

  return getOrSet(cacheKeys.quizLeaderboard(quizId), TTL_SECONDS, async () => {
    const attempts = await prisma.quizAttempt.findMany({
      where: { quizId, status: "SUBMITTED" },
      orderBy: [{ score: "desc" }, { timeTakenMs: "asc" }],
      select: { score: true, maxScore: true, timeTakenMs: true, student: { select: { id: true, name: true } } },
    });
    const rows = attempts.map((a) => ({
      studentId: a.student.id,
      name: a.student.name,
      score: a.score,
      maxScore: a.maxScore,
      percentage: a.maxScore ? Math.round((a.score / a.maxScore) * 1000) / 10 : 0,
      timeTakenMs: a.timeTakenMs ?? 0,
    }));
    return {
      quizId,
      title: quiz.title,
      generatedAt: new Date().toISOString(),
      entries: rank(rows, (a, b) => a.score === b.score && a.timeTakenMs === b.timeTakenMs),
    };
  });
}

// Total score across all of the batch's quizzes; less total time breaks ties.
export async function getBatchLeaderboard(batchId: string, user: AuthUser) {
  const batch = await getBatchForUser(batchId, user);
  if (!batch) throw new HttpError(404, "Batch not found");

  return getOrSet(cacheKeys.batchLeaderboard(batchId), TTL_SECONDS, async () => {
    const groups = await prisma.quizAttempt.groupBy({
      by: ["studentId"],
      where: { status: "SUBMITTED", quiz: { batchId } },
      _sum: { score: true, maxScore: true, timeTakenMs: true },
      _count: { _all: true },
    });
    const students = await prisma.user.findMany({
      where: { id: { in: groups.map((g) => g.studentId) } },
      select: { id: true, name: true },
    });
    const nameById = new Map(students.map((s) => [s.id, s.name]));

    const rows = groups
      .map((g) => {
        const total = g._sum.score ?? 0;
        const max = g._sum.maxScore ?? 0;
        return {
          studentId: g.studentId,
          name: nameById.get(g.studentId) ?? "Unknown",
          totalScore: total,
          maxScore: max,
          percentage: max ? Math.round((total / max) * 1000) / 10 : 0,
          quizzesTaken: g._count._all,
          totalTimeMs: g._sum.timeTakenMs ?? 0,
        };
      })
      .sort((a, b) => b.totalScore - a.totalScore || a.totalTimeMs - b.totalTimeMs);

    return {
      batchId,
      batchName: batch.name,
      generatedAt: new Date().toISOString(),
      entries: rank(rows, (a, b) => a.totalScore === b.totalScore && a.totalTimeMs === b.totalTimeMs),
    };
  });
}
