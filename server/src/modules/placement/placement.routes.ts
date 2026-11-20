import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { param } from "../../lib/params.js";
import { fileSafe } from "../../lib/csv.js";
import * as placement from "./placement.service.js";

// Placement readiness: per batch for mentors and admins, your own for students.
export const placementRouter = Router();
placementRouter.use(requireAuth);

const manager = requireRole("ADMIN", "MENTOR");

// GET /api/placement/me: the signed-in student's readiness and its parts
placementRouter.get("/me", requireRole("STUDENT"), async (req, res) => {
  res.json(await placement.myReadiness(req.user!));
});

// GET /api/placement/batches: every batch you manage, with its readiness summary
placementRouter.get("/batches", manager, async (req, res) => {
  res.json(await placement.overview(req.user!));
});

// GET /api/placement/batches/:id: every student in the batch, best prepared first
placementRouter.get("/batches/:id", manager, async (req, res) => {
  res.json(await placement.batchPlacement(param(req, "id"), req.user!));
});

// GET /api/placement/batches/:id/report.csv: the same, as a spreadsheet
placementRouter.get("/batches/:id/report.csv", manager, async (req, res) => {
  const { csv, batchName } = await placement.batchPlacementCsv(param(req, "id"), req.user!);
  const name = `placement-${fileSafe(batchName)}-${new Date().toISOString().slice(0, 10)}.csv`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.send(csv);
});
