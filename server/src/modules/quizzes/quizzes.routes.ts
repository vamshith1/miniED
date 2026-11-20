import { Router, type Response } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { param } from "../../lib/params.js";
import { limits } from "../../middleware/rate-limit.js";
import { createQuizSchema, listQuizzesQuery, practiceSubmitSchema, replaceQuizSchema, submitSchema } from "./quizzes.schemas.js";
import * as quizzes from "./quizzes.service.js";
import * as attempts from "./quizzes.attempts.js";
import { getQuizLeaderboard } from "./leaderboard.js";

export const quizzesRouter = Router();
quizzesRouter.use(requireAuth);

const manager = requireRole("ADMIN", "MENTOR");
const student = requireRole("STUDENT");

// X-Cache: HIT / MISS shows whether a response came from the cache.
export function sendCached(res: Response, { value, hit }: { value: unknown; hit: boolean }) {
  res.setHeader("X-Cache", hit ? "HIT" : "MISS");
  res.json(value);
}

// ---- Builder (admin, or the batch's mentor) ----

quizzesRouter.get("/", async (req, res) => {
  const { batchId } = listQuizzesQuery.parse(req.query);
  res.json({ items: await quizzes.listQuizzes(req.user!, batchId) });
});

quizzesRouter.post("/", manager, async (req, res) => {
  res.status(201).json({ quiz: await quizzes.createQuiz(createQuizSchema.parse(req.body), req.user!) });
});

quizzesRouter.get("/:id", manager, async (req, res) => {
  res.json({ quiz: await quizzes.getManagedQuiz(param(req, "id"), req.user!) });
});

quizzesRouter.put("/:id", manager, async (req, res) => {
  res.json({ quiz: await quizzes.replaceQuiz(param(req, "id"), replaceQuizSchema.parse(req.body), req.user!) });
});

quizzesRouter.post("/:id/publish", manager, async (req, res) => {
  res.json({ quiz: await quizzes.publishQuiz(param(req, "id"), req.user!) });
});

quizzesRouter.delete("/:id", manager, async (req, res) => {
  await quizzes.deleteQuiz(param(req, "id"), req.user!);
  res.status(204).end();
});

quizzesRouter.get("/:id/attempts", manager, async (req, res) => {
  res.json({ items: await quizzes.listAttempts(param(req, "id"), req.user!) });
});

// ---- Taking a quiz (students) ----

quizzesRouter.post("/:id/start", student, async (req, res) => {
  res.json(await attempts.startAttempt(param(req, "id"), req.user!));
});

quizzesRouter.post("/:id/submit", student, limits.quizSubmit, async (req, res) => {
  res.json(await attempts.submitAttempt(param(req, "id"), submitSchema.parse(req.body), req.user!));
});

quizzesRouter.get("/:id/result", student, async (req, res) => {
  res.json(await attempts.getMyResult(param(req, "id"), req.user!));
});

// ---- Practice (students): unlimited goes, never ranked

quizzesRouter.get("/:id/practice", student, async (req, res) => {
  res.json(await attempts.getPractice(param(req, "id"), req.user!));
});

quizzesRouter.post("/:id/practice", student, limits.quizSubmit, async (req, res) => {
  res.json(await attempts.submitPractice(param(req, "id"), practiceSubmitSchema.parse(req.body), req.user!));
});

// ---- Leaderboard (managers and students of the batch) ----

quizzesRouter.get("/:id/leaderboard", async (req, res) => {
  sendCached(res, await getQuizLeaderboard(param(req, "id"), req.user!));
});
