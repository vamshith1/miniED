import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { attendanceHistory, quizHistory, timeSpent } from "./progress.service.js";
import { mySkills } from "./skills.js";

// A student's own progress in detail. Students only: managers see the same data per batch.
export const progressRouter = Router();
progressRouter.use(requireAuth, requireRole("STUDENT"));

// GET /api/progress/quizzes: every finished attempt with marks, rank and class average
progressRouter.get("/quizzes", async (req, res) => {
  res.json(await quizHistory(req.user!));
});

// GET /api/progress/attendance: every marked day, counts and streaks
progressRouter.get("/attendance", async (req, res) => {
  res.json(await attendanceHistory(req.user!));
});

// GET /api/progress/time: learning time (class + quizzes), total and per week
progressRouter.get("/time", async (req, res) => {
  res.json(await timeSpent(req.user!));
});

// GET /api/progress/skills: accuracy per skill across submitted tests, gaps first
progressRouter.get("/skills", async (req, res) => {
  res.json(await mySkills(req.user!.id));
});
