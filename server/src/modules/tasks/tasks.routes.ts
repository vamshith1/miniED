import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { param } from "../../lib/params.js";
import * as tasks from "./tasks.service.js";

// Tasks a mentor sets a batch, and the work students hand in.
export const tasksRouter = Router();
tasksRouter.use(requireAuth);

const manager = requireRole("ADMIN", "MENTOR");
const student = requireRole("STUDENT");

// Managers: GET /api/tasks?batchId=… Students: their own batch's tasks.
tasksRouter.get("/", requireRole("ADMIN", "MENTOR", "STUDENT"), async (req, res) => {
  const { batchId } = tasks.listTasksQuery.parse(req.query);
  res.json({ items: await tasks.listTasks(req.user!, batchId) });
});

tasksRouter.post("/", manager, async (req, res) => {
  res.status(201).json({ task: await tasks.createTask(tasks.createTaskSchema.parse(req.body), req.user!) });
});

tasksRouter.patch("/:id", manager, async (req, res) => {
  res.json({ task: await tasks.updateTask(param(req, "id"), tasks.updateTaskSchema.parse(req.body), req.user!) });
});

tasksRouter.delete("/:id", manager, async (req, res) => {
  await tasks.deleteTask(param(req, "id"), req.user!);
  res.status(204).end();
});

tasksRouter.get("/:id/submissions", manager, async (req, res) => {
  res.json(await tasks.listSubmissions(param(req, "id"), req.user!));
});

tasksRouter.patch("/:id/submissions/:submissionId", manager, async (req, res) => {
  const body = tasks.reviewSchema.parse(req.body);
  res.json({ submission: await tasks.reviewSubmission(param(req, "id"), param(req, "submissionId"), body, req.user!) });
});

// Students hand in (or replace) their work.
tasksRouter.put("/:id/submission", student, async (req, res) => {
  res.json({ submission: await tasks.submit(param(req, "id"), tasks.submitSchema.parse(req.body), req.user!) });
});
