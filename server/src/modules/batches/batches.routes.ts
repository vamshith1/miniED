import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { addStudentSchema, createBatchSchema, updateBatchSchema } from "./batches.schemas.js";
import * as batches from "./batches.service.js";
import { param } from "../../lib/params.js";
import { batchAttendanceRouter } from "../attendance/attendance.routes.js";
import { getBatchLeaderboard } from "../quizzes/leaderboard.js";
import { sendCached } from "../quizzes/quizzes.routes.js";

export const batchesRouter = Router();
batchesRouter.use(requireAuth);

// Admin: all batches. Mentor: batches they run. Student: their own batch.
batchesRouter.get("/", async (req, res) => {
  res.json({ items: await batches.listBatchesForUser(req.user!) });
});

batchesRouter.post("/", requireRole("ADMIN"), async (req, res) => {
  res.status(201).json({ batch: await batches.createBatch(createBatchSchema.parse(req.body)) });
});

batchesRouter.get("/:id", async (req, res) => {
  res.json({ batch: await batches.getBatchForUser(param(req, "id"), req.user!) });
});

batchesRouter.patch("/:id", requireRole("ADMIN"), async (req, res) => {
  res.json({ batch: await batches.updateBatch(param(req, "id"), updateBatchSchema.parse(req.body)) });
});

// The student roster: admins and the batch's mentor.
batchesRouter.get("/:id/students", requireRole("ADMIN", "MENTOR"), async (req, res) => {
  await batches.assertCanManageBatch(param(req, "id"), req.user!);
  res.json({ items: await batches.listStudents(param(req, "id")) });
});

batchesRouter.post("/:id/students", requireRole("ADMIN"), async (req, res) => {
  const { studentId } = addStudentSchema.parse(req.body);
  res.json({ student: await batches.addStudent(param(req, "id"), studentId) });
});

batchesRouter.delete("/:id/students/:studentId", requireRole("ADMIN"), async (req, res) => {
  await batches.removeStudent(param(req, "id"), param(req, "studentId"));
  res.status(204).end();
});

// Total quiz scores across the batch. Anyone who can see the batch can see this.
batchesRouter.get("/:id/leaderboard", async (req, res) => {
  sendCached(res, await getBatchLeaderboard(param(req, "id"), req.user!));
});

// /api/batches/:id/attendance...
batchesRouter.use("/:id/attendance", batchAttendanceRouter);
