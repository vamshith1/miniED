import { Router, type Request } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { dayQuery, markAttendanceSchema } from "./attendance.schemas.js";
import * as attendance from "./attendance.service.js";
import { param } from "../../lib/params.js";

// Mounted at /api/batches/:id/attendance. mergeParams exposes the parent's :id.
export const batchAttendanceRouter = Router({ mergeParams: true });
const batchId = (req: Request) => param(req, "id");

batchAttendanceRouter.use(requireRole("ADMIN", "MENTOR"));

// PUT { date: "2026-11-07", records: [{ studentId, status }] }
batchAttendanceRouter.put("/", async (req, res) => {
  res.json(await attendance.markDay(batchId(req), markAttendanceSchema.parse(req.body), req.user!));
});

// GET ?date=2026-11-07: the roster with each student's status that day
batchAttendanceRouter.get("/", async (req, res) => {
  const { date } = dayQuery.parse(req.query);
  res.json(await attendance.getDay(batchId(req), date, req.user!));
});

batchAttendanceRouter.get("/summary", async (req, res) => {
  res.json(await attendance.batchSummary(batchId(req), req.user!));
});

// Mounted at /api/attendance
export const attendanceRouter = Router();

attendanceRouter.get("/me", requireAuth, requireRole("STUDENT"), async (req, res) => {
  res.json(await attendance.mySummary(req.user!));
});
