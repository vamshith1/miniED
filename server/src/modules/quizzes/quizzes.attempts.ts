import { Prisma, type Quiz } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../lib/http-error.js";
import { cacheKeys, invalidate } from "../../lib/cache.js";
import type { AuthUser } from "../../middleware/auth.js";
import { getStudentQuiz } from "./quizzes.service.js";
import { enqueueEmail } from "../emails/email.queue.js";
import type { PracticeSubmitInput, SubmitInput } from "./quizzes.schemas.js";
import { grade, passed, percentOf, type AnswerKey } from "./quizzes.grading.js";

// Extra time allowed after the timer ends, for slow networks.
export const GRACE_MS = 15_000;

const deadlineOf = (startedAt: Date, durationSeconds: number) => new Date(startedAt.getTime() + durationSeconds * 1000);
const isPastGrace = (startedAt: Date, durationSeconds: number, now = Date.now()) =>
  now > deadlineOf(startedAt, durationSeconds).getTime() + GRACE_MS;

// Questions as students see them: no isCorrect, no explanation.
const questionsForStudent = (quizId: string) =>
  prisma.question.findMany({
    where: { quizId },
    orderBy: { position: "asc" },
    select: {
      id: true,
      text: true,
      points: true,
      skill: true,
      options: { orderBy: { position: "asc" }, select: { id: true, text: true } },
    },
  });

const quizInfo = (q: Quiz) => ({
  id: q.id,
  title: q.title,
  description: q.description,
  durationSeconds: q.durationSeconds,
  mode: q.mode,
  negativePercent: q.negativePercent,
  passPercent: q.passPercent,
});

const answerKey = (quizId: string): Promise<AnswerKey[]> =>
  prisma.question.findMany({
    where: { quizId },
    select: { id: true, points: true, options: { select: { id: true, isCorrect: true } } },
  });

// Checks each answer belongs to this quiz and returns questionId → optionId.
function readAnswers(questions: AnswerKey[], answers: SubmitInput["answers"]) {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const chosen = new Map<string, string | null>();
  for (const a of answers) {
    const q = byId.get(a.questionId);
    if (!q) throw new HttpError(400, "An answer refers to a question that isn't in this quiz", { questionId: a.questionId });
    if (a.optionId && !q.options.some((o) => o.id === a.optionId)) {
      throw new HttpError(400, "An answer's option doesn't belong to its question", { questionId: a.questionId });
    }
    chosen.set(a.questionId, a.optionId);
  }
  return chosen;
}

// Every question with its right answer, explanation and skill, plus what the student chose.
async function review(quizId: string, chosen: Map<string, { optionId: string | null; isCorrect: boolean }>) {
  const questions = await prisma.question.findMany({
    where: { quizId },
    orderBy: { position: "asc" },
    include: { options: { orderBy: { position: "asc" }, select: { id: true, text: true, isCorrect: true } } },
  });
  return questions.map((q) => ({
    questionId: q.id,
    text: q.text,
    points: q.points,
    skill: q.skill,
    explanation: q.explanation,
    options: q.options,
    yourOptionId: chosen.get(q.id)?.optionId ?? null,
    correct: chosen.get(q.id)?.isCorrect ?? false,
  }));
}

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
  if (quiz.mode === "PRACTICE") throw new HttpError(409, "This is a practice quiz: open it in practice mode");

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
    quiz: quizInfo(quiz),
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

  // Grade against the answer key (unanswered questions count as skipped).
  const questions = await answerKey(quizId);
  const { score, maxScore, rows } = grade(questions, readAnswers(questions, input.answers), quiz.negativePercent);
  const timeTakenMs = Math.min(now - attempt.startedAt.getTime(), quiz.durationSeconds * 1000);

  await prisma.$transaction(async (tx) => {
    // The status guard means a double submit only ever scores once.
    const { count } = await tx.quizAttempt.updateMany({
      where: { id: attempt.id, status: "IN_PROGRESS" },
      data: { status: "SUBMITTED", score, maxScore, timeTakenMs, submittedAt: new Date(now) },
    });
    if (count === 0) throw new HttpError(409, "This attempt has already been submitted");
    await tx.attemptAnswer.createMany({ data: rows.map((r) => ({ ...r, attemptId: attempt.id })) });
  });

  // New score, so cached rankings and stats are now stale.
  await invalidate(cacheKeys.quizLeaderboard(quizId), cacheKeys.batchLeaderboard(quiz.batchId), cacheKeys.dashboardStats());
  await enqueueEmail("quiz-result", user.email, { attemptId: attempt.id });

  return getMyResult(quizId, user);
}

// After submitting: the score plus a review with the correct answers and explanations.
export async function getMyResult(quizId: string, user: AuthUser) {
  const quiz = await getStudentQuiz(quizId, user);
  const attempt = await prisma.quizAttempt.findUnique({
    where: { quizId_studentId: { quizId, studentId: user.id } },
    include: { answers: { select: { questionId: true, optionId: true, isCorrect: true } } },
  });
  if (!attempt) throw new HttpError(404, "You haven't attempted this quiz");
  if (attempt.status === "IN_PROGRESS") throw new HttpError(409, "Submit the quiz to see your result");

  const items = await review(quizId, new Map(attempt.answers.map((a) => [a.questionId, a])));
  const answered = attempt.answers.filter((a) => a.optionId);
  const correct = answered.filter((a) => a.isCorrect).length;
  return {
    status: attempt.status,
    score: attempt.score,
    maxScore: attempt.maxScore,
    percentage: percentOf(attempt.score, attempt.maxScore),
    passPercent: quiz.passPercent,
    // An expired attempt scores 0, so it hasn't passed.
    passed: passed(attempt.score, attempt.maxScore, quiz.passPercent),
    negativePercent: quiz.negativePercent,
    correct,
    wrong: answered.length - correct,
    skipped: items.length - answered.length,
    timeTakenMs: attempt.timeTakenMs,
    submittedAt: attempt.submittedAt,
    review: items,
  };
}

// ---------- Practice: as many goes as the student likes, answers shown straight after.

async function getPracticeQuiz(quizId: string, user: AuthUser) {
  const quiz = await getStudentQuiz(quizId, user);
  if (quiz.mode !== "PRACTICE") throw new HttpError(409, "This quiz is a test, not practice");
  return quiz;
}

const runsOf = (quizId: string, studentId: string) =>
  prisma.practiceRun.findMany({
    where: { quizId, studentId },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, score: true, maxScore: true, correct: true, wrong: true, skipped: true, timeTakenMs: true, createdAt: true },
  });

export async function getPractice(quizId: string, user: AuthUser) {
  const quiz = await getPracticeQuiz(quizId, user);
  return { quiz: quizInfo(quiz), questions: await questionsForStudent(quizId), runs: await runsOf(quizId, user.id) };
}

export async function submitPractice(quizId: string, input: PracticeSubmitInput, user: AuthUser) {
  const quiz = await getPracticeQuiz(quizId, user);
  const questions = await answerKey(quizId);
  const g = grade(questions, readAnswers(questions, input.answers), quiz.negativePercent);
  const timeTakenMs = input.timeTakenMs ?? null;
  await prisma.practiceRun.create({
    data: {
      quizId,
      studentId: user.id,
      score: g.score,
      maxScore: g.maxScore,
      correct: g.correct,
      wrong: g.wrong,
      skipped: g.skipped,
      timeTakenMs,
    },
  });
  return {
    status: "SUBMITTED" as const,
    score: g.score,
    maxScore: g.maxScore,
    percentage: percentOf(g.score, g.maxScore),
    passPercent: quiz.passPercent,
    passed: passed(g.score, g.maxScore, quiz.passPercent),
    negativePercent: quiz.negativePercent,
    correct: g.correct,
    wrong: g.wrong,
    skipped: g.skipped,
    timeTakenMs,
    submittedAt: new Date(),
    review: await review(quizId, new Map(g.rows.map((r) => [r.questionId, r]))),
    runs: await runsOf(quizId, user.id),
  };
}
