import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { param } from "../../lib/params.js";
import * as jobs from "./jobs.service.js";

// Jobs and campus drives: recruiters and admins post and hire, students apply.
export const jobsRouter = Router();
jobsRouter.use(requireAuth);

const hiring = requireRole("ADMIN", "RECRUITER");
const student = requireRole("STUDENT");

// ---- Students (registered before /:id so these paths aren't read as job ids)

jobsRouter.get("/applications/mine", student, async (req, res) => {
  res.json({ items: await jobs.myApplications(req.user!) });
});

// Opt in or out of the talent pool recruiters browse.
jobsRouter.put("/profile-sharing", student, async (req, res) => {
  res.json(await jobs.setShareProfile(jobs.shareSchema.parse(req.body).share, req.user!));
});

// ---- Recruiters and admins

jobsRouter.get("/talent", hiring, async (req, res) => {
  res.json(await jobs.talentPool(jobs.talentQuery.parse(req.query), req.user!));
});

jobsRouter.get("/batch-options", hiring, async (req, res) => {
  res.json({ items: await jobs.batchOptions(req.user!) });
});

jobsRouter.patch("/applications/:applicationId", hiring, async (req, res) => {
  res.json({ application: await jobs.setApplicationStatus(param(req, "applicationId"), jobs.statusSchema.parse(req.body).status, req.user!) });
});

jobsRouter.post("/applications/:applicationId/interviews", hiring, async (req, res) => {
  res.status(201).json({ interview: await jobs.scheduleInterview(param(req, "applicationId"), jobs.interviewSchema.parse(req.body), req.user!) });
});

jobsRouter.patch("/interviews/:interviewId", hiring, async (req, res) => {
  res.json({ interview: await jobs.updateInterview(param(req, "interviewId"), jobs.interviewUpdateSchema.parse(req.body), req.user!) });
});

// ---- Jobs

// Recruiters: their jobs. Admins: all. Students: what they can apply to, and what they applied to.
jobsRouter.get("/", requireRole("ADMIN", "RECRUITER", "STUDENT"), async (req, res) => {
  res.json({ items: await jobs.listJobs(req.user!) });
});

jobsRouter.post("/", hiring, async (req, res) => {
  res.status(201).json({ job: await jobs.createJob(jobs.createJobSchema.parse(req.body), req.user!) });
});

jobsRouter.get("/:id", requireRole("ADMIN", "RECRUITER", "STUDENT"), async (req, res) => {
  res.json({ job: await jobs.getJob(param(req, "id"), req.user!) });
});

jobsRouter.patch("/:id", hiring, async (req, res) => {
  res.json({ job: await jobs.updateJob(param(req, "id"), jobs.updateJobSchema.parse(req.body), req.user!) });
});

jobsRouter.get("/:id/applicants", hiring, async (req, res) => {
  res.json(await jobs.listApplicants(param(req, "id"), req.user!));
});

jobsRouter.post("/:id/apply", student, async (req, res) => {
  res.status(201).json({ application: await jobs.apply(param(req, "id"), jobs.applySchema.parse(req.body), req.user!) });
});

jobsRouter.post("/:id/withdraw", student, async (req, res) => {
  res.json({ application: await jobs.withdraw(param(req, "id"), req.user!) });
});
