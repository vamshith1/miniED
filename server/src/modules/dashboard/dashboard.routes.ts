import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { sendCached } from "../quizzes/quizzes.routes.js";
import { getDashboardStats } from "./dashboard.service.js";

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth, requireRole("ADMIN"));

// GET /api/dashboard/stats: numbers for the admin dashboard charts (cached 60 s)
dashboardRouter.get("/stats", async (_req, res) => {
  sendCached(res, await getDashboardStats());
});
