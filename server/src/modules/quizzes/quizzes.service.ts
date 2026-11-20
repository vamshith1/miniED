import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../lib/http-error.js";
import type { AuthUser } from "../../middleware/auth.js";
import { assertCanManageBatch } from "../batches/batches.service.js";
import type { QuizContent } from "./quizzes.schemas.js";

// Full quiz for mentors/admins, correct answers included.
const fullInclude = {
  questions: {
    orderBy: { position: "asc" },
    include: { options: { orderBy: { position: "asc" } } },
  },
  batch: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  _count: { select: { attempts: true } },
} satisfies Prisma.QuizInclude;

// Turns the request's question list into nested Prisma creates, saving
// the order questions and options were written in.
const questionCreates = (questions: QuizContent["questions"]) =>
  questions.map((q, qi) => ({
    text: q.text,
    points: q.points,
    skill: q.skill,
    explanation: q.explanation,
    position: qi,
    options: { create: q.options.map((o, oi) => ({ text: o.text, isCorrect: o.isCorrect, position: oi })) },
  }));

/**
 * Loads a quiz and checks the user may manage it (admin, or the mentor of
 * its batch). Students get 404 here: they use the attempt endpoints.
 */
export async function getManagedQuiz(quizId: string, user: AuthUser) {
  const quiz = await prisma.quiz.findUnique({ where: { id: quizId }, include: fullInclude });
  if (!quiz || user.role === "STUDENT") throw new HttpError(404, "Quiz not found");
  await assertCanManageBatch(quiz.batchId, user);
  return quiz;
}

// A published quiz in the student's own batch, otherwise 404.
export async function getStudentQuiz(quizId: string, user: AuthUser) {
  const quiz = await prisma.quiz.findUnique({ where: { id: quizId } });
  if (!quiz || !quiz.isPublished || quiz.batchId !== user.batchId) throw new HttpError(404, "Quiz not found");
  return quiz;
}

export async function createQuiz(input: QuizContent & { batchId: string }, user: AuthUser) {
  await assertCanManageBatch(input.batchId, user);
  const { questions, ...rest } = input;
  return prisma.quiz.create({
    data: { ...rest, createdById: user.id, questions: { create: questionCreates(questions) } },
    include: fullInclude,
  });
}

// Drafts only: once published, students may already be taking it.
export async function replaceQuiz(quizId: string, input: QuizContent, user: AuthUser) {
  const quiz = await getManagedQuiz(quizId, user);
  if (quiz.isPublished) throw new HttpError(409, "Published quizzes can't be edited");
  const { questions, ...rest } = input;
  return prisma.$transaction(async (tx) => {
    await tx.question.deleteMany({ where: { quizId } }); // options cascade
    return tx.quiz.update({
      where: { id: quizId },
      data: { ...rest, questions: { create: questionCreates(questions) } },
      include: fullInclude,
    });
  });
}

export async function publishQuiz(quizId: string, user: AuthUser) {
  const quiz = await getManagedQuiz(quizId, user);
  if (quiz.isPublished) throw new HttpError(409, "Quiz is already published");
  if (quiz.questions.length === 0) throw new HttpError(400, "Add at least one question before publishing");
  return prisma.quiz.update({ where: { id: quizId }, data: { isPublished: true }, include: fullInclude });
}

export async function deleteQuiz(quizId: string, user: AuthUser) {
  const quiz = await getManagedQuiz(quizId, user);
  if (quiz._count.attempts > 0) throw new HttpError(409, "This quiz has attempts and can't be deleted");
  await prisma.quiz.delete({ where: { id: quizId } });
}

/**
 * Mentors/admins: quizzes in the batches they manage (optionally one batch).
 * Students: published quizzes in their batch, with their own attempt status.
 */
export async function listQuizzes(user: AuthUser, batchId?: string) {
  if (user.role === "STUDENT") {
    const quizzes = await prisma.quiz.findMany({
      where: { batchId: user.batchId ?? "__none__", isPublished: true },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        description: true,
        durationSeconds: true,
        mode: true,
        negativePercent: true,
        passPercent: true,
        createdAt: true,
        _count: { select: { questions: true } },
        attempts: { where: { studentId: user.id }, select: { status: true, score: true, maxScore: true } },
        practiceRuns: { where: { studentId: user.id }, select: { score: true, maxScore: true } },
      },
    });
    return quizzes.map(({ attempts, practiceRuns, ...q }) => ({
      ...q,
      myAttempt: attempts[0] ?? null,
      myPractice: practiceRuns.length
        ? {
            runs: practiceRuns.length,
            bestPercentage: Math.max(...practiceRuns.map((r) => (r.maxScore ? Math.round((r.score / r.maxScore) * 1000) / 10 : 0))),
          }
        : null,
    }));
  }

  if (batchId) await assertCanManageBatch(batchId, user);
  const where: Prisma.QuizWhereInput = {
    ...(batchId && { batchId }),
    ...(user.role === "MENTOR" && { batch: { mentorId: user.id } }),
  };
  return prisma.quiz.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: { batch: { select: { id: true, name: true } }, _count: { select: { questions: true, attempts: true } } },
  });
}

// Every attempt on a quiz, for its mentor/admin.
export async function listAttempts(quizId: string, user: AuthUser) {
  await getManagedQuiz(quizId, user);
  return prisma.quizAttempt.findMany({
    where: { quizId },
    orderBy: [{ score: "desc" }, { timeTakenMs: "asc" }],
    select: {
      id: true,
      status: true,
      score: true,
      maxScore: true,
      timeTakenMs: true,
      startedAt: true,
      submittedAt: true,
      student: { select: { id: true, name: true, email: true } },
    },
  });
}
