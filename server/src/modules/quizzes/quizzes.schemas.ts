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
  questions: z.array(questionSchema).max(200).default([]),
};

export const createQuizSchema = z.object({ ...quizContent, batchId: z.string().min(1) });

// PUT replaces the whole draft (title, settings and all questions).
export const replaceQuizSchema = z.object(quizContent);

export const listQuizzesQuery = z.object({ batchId: z.string().optional() });

export const submitSchema = z.object({
  answers: z
    .array(z.object({ questionId: z.string().min(1), optionId: z.string().min(1).nullable() }))
    .max(200)
    .refine((a) => new Set(a.map((x) => x.questionId)).size === a.length, "Each question can be answered only once"),
});

export type QuizContent = z.infer<typeof replaceQuizSchema>;
export type SubmitInput = z.infer<typeof submitSchema>;
