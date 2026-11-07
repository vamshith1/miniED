import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { limits } from "../../middleware/rate-limit.js";
import { paginationQuery } from "../../lib/pagination.js";
import {
  addNoteSchema,
  changeStageSchema,
  convertLeadSchema,
  createLeadSchema,
  listLeadsQuery,
  updateLeadSchema,
} from "./leads.schemas.js";
import { convertLead } from "./leads.convert.js";
import * as leads from "./leads.service.js";
import { csvUpload, importLeadsCsv } from "./leads.import.js";

export const leadsRouter = Router();

// The lead pipeline is managed by admins.
leadsRouter.use(requireAuth, requireRole("ADMIN"));

leadsRouter.get("/", async (req, res) => {
  res.json(await leads.listLeads(listLeadsQuery.parse(req.query)));
});

leadsRouter.post("/", async (req, res) => {
  res.status(201).json({ lead: await leads.createLead(createLeadSchema.parse(req.body), req.user!.id) });
});

// Must be registered before "/:id" so "import" isn't treated as an id.
// multipart/form-data with a "file" field
leadsRouter.post("/import", limits.csvImport, csvUpload, async (req, res) => {
  res.json(await importLeadsCsv(req.file, req.user!.id));
});

leadsRouter.get("/:id", async (req, res) => {
  res.json({ lead: await leads.getLeadOr404(req.params.id) });
});

leadsRouter.patch("/:id", async (req, res) => {
  res.json({ lead: await leads.updateLead(req.params.id, updateLeadSchema.parse(req.body), req.user!.id) });
});

leadsRouter.delete("/:id", async (req, res) => {
  await leads.deleteLead(req.params.id);
  res.status(204).end();
});

leadsRouter.patch("/:id/stage", async (req, res) => {
  const { stage, note } = changeStageSchema.parse(req.body);
  res.json({ lead: await leads.changeStage(req.params.id, stage, req.user!.id, note) });
});

// POST /api/leads/:id/convert { batchId, password? }
leadsRouter.post("/:id/convert", async (req, res) => {
  const { batchId, password } = convertLeadSchema.parse(req.body);
  res.status(201).json(await convertLead(req.params.id, batchId, req.user!.id, password));
});

leadsRouter.get("/:id/notes", async (req, res) => {
  res.json(await leads.listNotes(req.params.id, paginationQuery.parse(req.query)));
});

leadsRouter.post("/:id/notes", async (req, res) => {
  const { body } = addNoteSchema.parse(req.body);
  res.status(201).json({ note: await leads.addNote(req.params.id, body, req.user!.id) });
});

leadsRouter.get("/:id/timeline", async (req, res) => {
  res.json(await leads.getTimeline(req.params.id, paginationQuery.parse(req.query)));
});
