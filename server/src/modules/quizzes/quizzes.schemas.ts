import { z } from "zod";

const optionSchema = z.object({
  text: z.string().trim().min(1).max(500),
  isCorrect: z.boolean().default(false),
});

// Single-answer MCQ: 2–6 options with exactly one correct.
const questionSchema = z
  .object({
    text: z.string().trim().min(1).max(2000),
    points: z.number().int().min(1).max(100).default(1),
    skill: z.string().trim().max(60).nullish().transform((v) => v || null),
    explanation: z.string().trim().max(2000).nullish().transform((v) => v || null),
    options: z.array(optionSchema).min(2).max(6),
  })
  .refine((q) => q.options.filter((o) => o.isCorrect).length === 1, {
    message: "Each question needs exactly one correct option",
    path: ["options"],
  });

const quizContent = {
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(2000).optional(),
  durationSeconds: z.number().int().min(30).max(3 * 60 * 60), // 30 s to 3 h
  mode: z.enum(["TEST", "PRACTICE"]).default("TEST"),
  negativePercent: z.number().int().min(0).max(100).default(0),
  passPercent: z.number().int().min(1).max(100).nullish().transform((v) => v ?? null),
  opensAt: z.coerce.date().nullish().transform((v) => v ?? null),
  closesAt: z.coerce.date().nullish().transform((v) => v ?? null),
  questions: z.array(questionSchema).max(200).default([]),
};

const windowOk = (q: { opensAt: Date | null; closesAt: Date | null }) => !q.opensAt || !q.closesAt || q.closesAt > q.opensAt;
const windowRule = { message: "It must close after it opens", path: ["closesAt"] };

// A batch quiz, or a job's hiring test: exactly one of batchId / jobId.
export const createQuizSchema = z
  .object({ ...quizContent, batchId: z.string().min(1).optional(), jobId: z.string().min(1).optional() })
  .refine((q) => !!q.batchId !== !!q.jobId, { message: "Give either batchId or jobId", path: ["batchId"] })
  .refine(windowOk, windowRule);

// PUT replaces the whole draft (title, settings and all questions).
export const replaceQuizSchema = z.object(quizContent).refine(windowOk, windowRule);

export const listQuizzesQuery = z.object({ batchId: z.string().optional(), jobId: z.string().optional() });

export const submitSchema = z.object({
  answers: z
    .array(z.object({ questionId: z.string().min(1), optionId: z.string().min(1).nullable() }))
    .max(200)
    .refine((a) => new Set(a.map((x) => x.questionId)).size === a.length, "Each question can be answered only once"),
});

export const practiceSubmitSchema = submitSchema.extend({
  // Measured by the browser: practice has no server-side timer.
  timeTakenMs: z.number().int().min(0).max(24 * 60 * 60 * 1000).optional(),
});

export type QuizContent = z.infer<typeof replaceQuizSchema>;
export type SubmitInput = z.infer<typeof submitSchema>;
export type PracticeSubmitInput = z.infer<typeof practiceSubmitSchema>;
