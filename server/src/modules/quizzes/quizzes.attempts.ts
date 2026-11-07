import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../lib/http-error.js";
import { cacheKeys, invalidate } from "../../lib/cache.js";
import type { AuthUser } from "../../middleware/auth.js";
import { getStudentQuiz } from "./quizzes.service.js";
import { enqueueEmail } from "../emails/email.queue.js";
import type { SubmitInput } from "./quizzes.schemas.js";

// Extra time allowed after the timer ends, for slow networks.
export const GRACE_MS = 15_000;

const deadlineOf = (startedAt: Date, durationSeconds: number) => new Date(startedAt.getTime() + durationSeconds * 1000);
const isPastGrace = (startedAt: Date, durationSeconds: number, now = Date.now()) =>
  now > deadlineOf(startedAt, durationSeconds).getTime() + GRACE_MS;

// Questions as students see them: no isCorrect anywhere.
const questionsForStudent = (quizId: string) =>
  prisma.question.findMany({
    where: { quizId },
    orderBy: { position: "asc" },
    select: {
      id: true,
      text: true,
      points: true,
      options: { orderBy: { position: "asc" }, select: { id: true, text: true } },
    },
  });

async function expire(attemptId: string) {
  await prisma.quizAttempt.updateMany({
    where: { id: attemptId, status: "IN_PROGRESS" },
    data: { status: "EXPIRED", score: 0, submittedAt: new Date() },
  });
}

/**
 * Starts the timer, or resumes the attempt if the student reloads the page.
 * The server's startedAt is the only clock that counts.
 */
export async function startAttempt(quizId: string, user: AuthUser) {
  const quiz = await getStudentQuiz(quizId, user);

  let attempt = await prisma.quizAttempt.findUnique({ where: { quizId_studentId: { quizId, studentId: user.id } } });

  if (attempt && attempt.status !== "IN_PROGRESS") {
    throw new HttpError(409, "You have already attempted this quiz", { status: attempt.status });
  }
  if (attempt && isPastGrace(attempt.startedAt, quiz.durationSeconds)) {
    await expire(attempt.id);
    throw new HttpError(409, "Time is up: this attempt has expired", { status: "EXPIRED" });
  }

  if (!attempt) {
    const maxScore = (await prisma.question.aggregate({ where: { quizId }, _sum: { points: true } }))._sum.points ?? 0;
    try {
      attempt = await prisma.quizAttempt.create({ data: { quizId, studentId: user.id, maxScore } });
    } catch (err) {
      // Two "start" clicks at once: the unique (quizId, studentId) lets one
      // win, and the other just resumes it.
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
      attempt = await prisma.quizAttempt.findUniqueOrThrow({ where: { quizId_studentId: { quizId, studentId: user.id } } });
    }
  }

  return {
    attemptId: attempt.id,
    startedAt: attempt.startedAt,
    expiresAt: deadlineOf(attempt.startedAt, quiz.durationSeconds),
    quiz: { id: quiz.id, title: quiz.title, description: quiz.description, durationSeconds: quiz.durationSeconds },
    questions: await questionsForStudent(quizId),
  };
}

export async function submitAttempt(quizId: string, input: SubmitInput, user: AuthUser) {
  const quiz = await getStudentQuiz(quizId, user);
  const attempt = await prisma.quizAttempt.findUnique({ where: { quizId_studentId: { quizId, studentId: user.id } } });
  if (!attempt) throw new HttpError(400, "Start the quiz before submitting");
  if (attempt.status !== "IN_PROGRESS") {
    throw new HttpError(409, "This attempt has already been submitted", { status: attempt.status });
  }

  const now = Date.now();
  if (isPastGrace(attempt.startedAt, quiz.durationSeconds, now)) {
    await expire(attempt.id);
    throw new HttpError(409, "Time is up: this attempt has expired", { status: "EXPIRED" });
  }

  // Load the answer key and check every answer belongs to this quiz.
  const questions = await prisma.question.findMany({
    where: { quizId },
    select: { id: true, points: true, options: { select: { id: true, isCorrect: true } } },
  });
  const byId = new Map(questions.map((q) => [q.id, q]));
  const chosen = new Map<string, string | null>();
  for (const a of input.answers) {
    const q = byId.get(a.questionId);
    if (!q) throw new HttpError(400, "An answer refers to a question that isn't in this quiz", { questionId: a.questionId });
    if (a.optionId && !q.options.some((o) => o.id === a.optionId)) {
      throw new HttpError(400, "An answer's option doesn't belong to its question", { questionId: a.questionId });
    }
    chosen.set(a.questionId, a.optionId);
  }

  // Grade. Questions the student didn't answer count as wrong.
  let score = 0;
  const rows = questions.map((q) => {
    const optionId = chosen.get(q.id) ?? null;
    const isCorrect = !!optionId && q.options.some((o) => o.id === optionId && o.isCorrect);
    if (isCorrect) score += q.points;
    return { attemptId: attempt.id, questionId: q.id, optionId, isCorrect };
  });
  const maxScore = questions.reduce((s, q) => s + q.points, 0);
  const timeTakenMs = Math.min(now - attempt.startedAt.getTime(), quiz.durationSeconds * 1000);

  await prisma.$transaction(async (tx) => {
    // The status guard means a double submit only ever scores once.
    const { count } = await tx.quizAttempt.updateMany({
      where: { id: attempt.id, status: "IN_PROGRESS" },
      data: { status: "SUBMITTED", score, maxScore, timeTakenMs, submittedAt: new Date(now) },
    });
    if (count === 0) throw new HttpError(409, "This attempt has already been submitted");
    await tx.attemptAnswer.createMany({ data: rows });
  });

  // New score, so cached rankings and stats are now stale.
  await invalidate(cacheKeys.quizLeaderboard(quizId), cacheKeys.batchLeaderboard(quiz.batchId), cacheKeys.dashboardStats());
  await enqueueEmail("quiz-result", user.email, { attemptId: attempt.id });

  return getMyResult(quizId, user);
}

// After submitting: the score plus a review with the correct answers.
export async function getMyResult(quizId: string, user: AuthUser) {
  await getStudentQuiz(quizId, user);
  const attempt = await prisma.quizAttempt.findUnique({
    where: { quizId_studentId: { quizId, studentId: user.id } },
    include: { answers: { select: { questionId: true, optionId: true, isCorrect: true } } },
  });
  if (!attempt) throw new HttpError(404, "You haven't attempted this quiz");
  if (attempt.status === "IN_PROGRESS") throw new HttpError(409, "Submit the quiz to see your result");

  const answerFor = new Map(attempt.answers.map((a) => [a.questionId, a]));
  const questions = await prisma.question.findMany({
    where: { quizId },
    orderBy: { position: "asc" },
    include: { options: { orderBy: { position: "asc" }, select: { id: true, text: true, isCorrect: true } } },
  });

  return {
    status: attempt.status,
    score: attempt.score,
    maxScore: attempt.maxScore,
    percentage: attempt.maxScore ? Math.round((attempt.score / attempt.maxScore) * 1000) / 10 : 0,
    timeTakenMs: attempt.timeTakenMs,
    submittedAt: attempt.submittedAt,
    review: questions.map((q) => ({
      questionId: q.id,
      text: q.text,
      points: q.points,
      options: q.options,
      yourOptionId: answerFor.get(q.id)?.optionId ?? null,
      correct: answerFor.get(q.id)?.isCorrect ?? false,
    })),
  };
}
