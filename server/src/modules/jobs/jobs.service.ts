import type { ApplicationStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../lib/http-error.js";
import type { AuthUser } from "../../middleware/auth.js";
import { enqueueEmail } from "../emails/email.queue.js";
import { readinessFor } from "../placement/placement.service.js";

// ---------- Input

const httpUrl = z
  .string()
  .trim()
  .max(500)
  .url()
  .refine((u) => /^https?:\/\//i.test(u), "Use a link starting with http:// or https://");

const jobFields = {
  title: z.string().trim().min(2).max(200),
  company: z.string().trim().min(2).max(120).optional(), // defaults to the recruiter's company
  location: z.string().trim().max(120).nullish().transform((v) => v || null),
  type: z.enum(["FULL_TIME", "INTERNSHIP", "CONTRACT"]).default("FULL_TIME"),
  salary: z.string().trim().max(80).nullish().transform((v) => v || null),
  description: z.string().trim().min(10).max(10_000),
  skills: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  minReadiness: z.number().int().min(1).max(100).nullish().transform((v) => v ?? null),
  deadline: z.coerce.date().nullish().transform((v) => v ?? null),
  // A campus drive: only these batches may apply. Empty = every student.
  batchIds: z.array(z.string().min(1)).max(50).default([]),
};

export const createJobSchema = z.object(jobFields);
export const updateJobSchema = z
  .object({ ...jobFields, status: z.enum(["OPEN", "CLOSED"]) })
  .partial()
  .refine((o) => Object.keys(o).length > 0, "Send at least one field to update");

export const applySchema = z.object({ coverNote: z.string().trim().max(3000).nullish().transform((v) => v || null) });

export const statusSchema = z.object({ status: z.enum(["APPLIED", "SHORTLISTED", "INTERVIEW", "OFFERED", "HIRED", "REJECTED"]) });

const interviewFields = {
  scheduledAt: z.coerce.date(),
  durationMinutes: z.number().int().min(10).max(480).default(30),
  mode: z.enum(["ONLINE", "IN_PERSON", "PHONE"]).default("ONLINE"),
  location: z.string().trim().max(500).nullish().transform((v) => v || null),
  notes: z.string().trim().max(3000).nullish().transform((v) => v || null),
};
export const interviewSchema = z.object(interviewFields).refine((i) => i.mode !== "ONLINE" || !i.location || httpUrl.safeParse(i.location).success, {
  message: "An online interview's location must be a meeting link (https://…)",
  path: ["location"],
});
export const interviewUpdateSchema = z
  .object({
    ...interviewFields,
    outcome: z.enum(["PENDING", "PASSED", "FAILED", "NO_SHOW"]),
    feedback: z.string().trim().max(3000).nullish().transform((v) => v || null),
  })
  .partial();

export const talentQuery = z.object({
  q: z.string().trim().max(100).optional(),
  skill: z.string().trim().max(60).optional(),
  minReadiness: z.coerce.number().min(0).max(100).optional(),
  batchId: z.string().optional(),
});

export const shareSchema = z.object({ share: z.boolean() });

// ---------- Access

const isManager = (u: AuthUser) => u.role === "ADMIN" || u.role === "RECRUITER";

/** Admins manage every job; a recruiter only the ones they posted. Others get 404. */
export async function assertCanManageJob(jobId: string, user: AuthUser) {
  const job = await prisma.job.findUnique({ where: { id: jobId }, include: { batches: { select: { id: true, name: true } } } });
  if (!job || !isManager(user) || (user.role === "RECRUITER" && job.postedById !== user.id)) throw new HttpError(404, "Job not found");
  return job;
}

type JobForEligibility = { status: string; deadline: Date | null; batches: { id: string }[] };

/** Why a student can't apply, or null if they can. */
function ineligible(job: JobForEligibility, user: AuthUser) {
  if (job.status !== "OPEN") return "This job is closed";
  if (job.deadline && job.deadline < new Date()) return "The application deadline has passed";
  if (job.batches.length && !job.batches.some((b) => b.id === user.batchId)) return "This campus drive is for other batches";
  return null;
}

async function assertBatches(batchIds: string[]) {
  if (!batchIds.length) return;
  const found = await prisma.batch.count({ where: { id: { in: batchIds } } });
  if (found !== new Set(batchIds).size) throw new HttpError(400, "One of the batches doesn't exist");
}

const jobInclude = {
  batches: { select: { id: true, name: true } },
  postedBy: { select: { id: true, name: true, company: true } },
  tests: { select: { id: true, title: true, isPublished: true, durationSeconds: true, opensAt: true, closesAt: true } },
} satisfies Prisma.JobInclude;

// ---------- Jobs

export async function createJob(input: z.infer<typeof createJobSchema>, user: AuthUser) {
  const { batchIds, ...data } = input;
  await assertBatches(batchIds);
  const me = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { company: true } });
  const company = data.company ?? me.company;
  if (!company) throw new HttpError(400, "Add the company name", { company: "Required" });
  return prisma.job.create({
    data: {
      ...data,
      company,
      skills: [...new Set(data.skills)],
      isCampusDrive: batchIds.length > 0,
      postedById: user.id,
      batches: { connect: batchIds.map((id) => ({ id })) },
    },
    include: jobInclude,
  });
}

export async function updateJob(jobId: string, input: z.infer<typeof updateJobSchema>, user: AuthUser) {
  await assertCanManageJob(jobId, user);
  const { batchIds, ...data } = input;
  if (batchIds) await assertBatches(batchIds);
  return prisma.job.update({
    where: { id: jobId },
    data: {
      ...data,
      ...(data.skills && { skills: [...new Set(data.skills)] }),
      ...(batchIds && { isCampusDrive: batchIds.length > 0, batches: { set: batchIds.map((id) => ({ id })) } }),
    },
    include: jobInclude,
  });
}

const PIPELINE: ApplicationStatus[] = ["APPLIED", "SHORTLISTED", "INTERVIEW", "OFFERED", "HIRED", "REJECTED", "WITHDRAWN"];

/**
 * Recruiters: their jobs. Admins: every job. Both with applicant counts per stage.
 * Students: open jobs they can apply to, plus any they've applied to, with their application.
 */
export async function listJobs(user: AuthUser) {
  if (user.role === "STUDENT") {
    const jobs = await prisma.job.findMany({
      where: {
        OR: [
          { status: "OPEN", AND: [{ OR: [{ deadline: null }, { deadline: { gte: new Date() } }] }, { OR: [{ batches: { none: {} } }, { batches: { some: { id: user.batchId ?? "__none__" } } }] }] },
          { applications: { some: { studentId: user.id } } },
        ],
      },
      orderBy: { createdAt: "desc" },
      include: {
        batches: { select: { id: true, name: true } },
        applications: { where: { studentId: user.id }, select: { id: true, status: true, createdAt: true } },
      },
    });
    const me = (await readinessFor([{ id: user.id, batchId: user.batchId }])).get(user.id)!;
    return jobs.map(({ applications, ...j }) => {
      const reason = ineligible(j, user) ?? (j.minReadiness != null && (me.readiness ?? 0) < j.minReadiness ? `Needs ${j.minReadiness}% readiness (you have ${me.readiness ?? 0}%)` : null);
      return { ...j, myApplication: applications[0] ?? null, canApply: !reason, cannotApplyReason: reason };
    });
  }
  if (!isManager(user)) throw new HttpError(403, "Not allowed");
  const jobs = await prisma.job.findMany({
    where: user.role === "RECRUITER" ? { postedById: user.id } : {},
    orderBy: { createdAt: "desc" },
    include: { ...jobInclude, applications: { select: { status: true } } },
  });
  return jobs.map(({ applications, ...j }) => ({
    ...j,
    applicants: applications.filter((a) => a.status !== "WITHDRAWN").length,
    byStatus: Object.fromEntries(PIPELINE.map((s) => [s, applications.filter((a) => a.status === s).length])),
  }));
}

export async function getJob(jobId: string, user: AuthUser) {
  if (isManager(user)) {
    await assertCanManageJob(jobId, user);
    return prisma.job.findUniqueOrThrow({ where: { id: jobId }, include: jobInclude });
  }
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: {
      batches: { select: { id: true, name: true } },
      // Students only see published tests, and only once they've applied.
      tests: { where: { isPublished: true }, select: { id: true, title: true, durationSeconds: true, opensAt: true, closesAt: true } },
      applications: { where: { studentId: user.id }, include: { interviews: { select: { id: true, scheduledAt: true, durationMinutes: true, mode: true, location: true, notes: true, outcome: true }, orderBy: { scheduledAt: "asc" } } } },
    },
  });
  const app = job?.applications[0];
  // Students see open jobs meant for them, and anything they've applied to.
  const forMyBatch = !job?.batches.length || job.batches.some((b) => b.id === user.batchId);
  if (!job || (!app && !(job.status === "OPEN" && forMyBatch))) throw new HttpError(404, "Job not found");
  const { applications, tests, ...rest } = job;
  return { ...rest, tests: app && app.status !== "WITHDRAWN" && app.status !== "REJECTED" ? tests : [], myApplication: app ?? null };
}

// ---------- Applying (students)

export async function apply(jobId: string, input: z.infer<typeof applySchema>, user: AuthUser) {
  const job = await prisma.job.findUnique({ where: { id: jobId }, include: { batches: { select: { id: true } } } });
  if (!job) throw new HttpError(404, "Job not found");
  const reason = ineligible(job, user);
  if (reason) throw new HttpError(409, reason);
  const me = (await readinessFor([{ id: user.id, batchId: user.batchId }])).get(user.id)!;
  if (job.minReadiness != null && (me.readiness ?? 0) < job.minReadiness) {
    throw new HttpError(409, `This job needs ${job.minReadiness}% placement readiness; you're at ${me.readiness ?? 0}%`);
  }
  const existing = await prisma.jobApplication.findUnique({ where: { jobId_studentId: { jobId, studentId: user.id } } });
  if (existing && existing.status !== "WITHDRAWN") throw new HttpError(409, "You've already applied");
  const data = { status: "APPLIED" as const, coverNote: input.coverNote, readinessAtApply: me.readiness };
  return existing
    ? prisma.jobApplication.update({ where: { id: existing.id }, data })
    : prisma.jobApplication.create({ data: { ...data, jobId, studentId: user.id } });
}

export async function withdraw(jobId: string, user: AuthUser) {
  const app = await prisma.jobApplication.findUnique({ where: { jobId_studentId: { jobId, studentId: user.id } } });
  if (!app) throw new HttpError(404, "You haven't applied to this job");
  if (app.status === "HIRED" || app.status === "WITHDRAWN") throw new HttpError(409, `This application is already ${app.status.toLowerCase()}`);
  return prisma.jobApplication.update({ where: { id: app.id }, data: { status: "WITHDRAWN" } });
}

/** A student's applications, with their interviews (the recruiter's private feedback left out). */
export async function myApplications(user: AuthUser) {
  return prisma.jobApplication.findMany({
    where: { studentId: user.id },
    orderBy: { updatedAt: "desc" },
    include: {
      job: { select: { id: true, title: true, company: true, location: true, type: true, status: true } },
      interviews: { select: { id: true, scheduledAt: true, durationMinutes: true, mode: true, location: true, notes: true, outcome: true }, orderBy: { scheduledAt: "asc" } },
    },
  });
}

export async function setShareProfile(share: boolean, user: AuthUser) {
  return prisma.user.update({ where: { id: user.id }, data: { shareProfile: share }, select: { shareProfile: true } });
}

// ---------- Applicants (recruiters, admins)

const latestResume = (ownerIds: string[]) =>
  prisma.document.findMany({ where: { ownerId: { in: ownerIds }, kind: "RESUME" }, orderBy: { createdAt: "desc" }, select: { id: true, ownerId: true, originalName: true } });

export async function listApplicants(jobId: string, user: AuthUser) {
  const job = await assertCanManageJob(jobId, user);
  const apps = await prisma.jobApplication.findMany({
    where: { jobId },
    orderBy: { createdAt: "asc" },
    include: {
      student: { select: { id: true, name: true, email: true, phone: true, batchId: true, batch: { select: { name: true, course: true } } } },
      interviews: { orderBy: { scheduledAt: "asc" } },
    },
  });
  const ids = apps.map((a) => a.student.id);
  const [readiness, resumes, tests] = await Promise.all([
    readinessFor(apps.map((a) => ({ id: a.student.id, batchId: a.student.batchId }))),
    latestResume(ids),
    prisma.quizAttempt.findMany({
      where: { quiz: { jobId }, studentId: { in: ids } },
      select: { quizId: true, studentId: true, status: true, score: true, maxScore: true, timeTakenMs: true },
    }),
  ]);
  const resumeOf = new Map<string, { id: string; originalName: string }>();
  for (const r of resumes) if (!resumeOf.has(r.ownerId)) resumeOf.set(r.ownerId, { id: r.id, originalName: r.originalName });

  return {
    job: { id: job.id, title: job.title, company: job.company, minReadiness: job.minReadiness },
    items: apps.map((a) => {
      const r = readiness.get(a.student.id)!;
      return {
        id: a.id,
        status: a.status,
        coverNote: a.coverNote,
        appliedAt: a.createdAt,
        updatedAt: a.updatedAt,
        readinessAtApply: a.readinessAtApply,
        student: { id: a.student.id, name: a.student.name, email: a.student.email, phone: a.student.phone, batch: a.student.batch },
        readiness: r.readiness,
        band: r.band,
        strengths: r.strengths,
        gaps: r.gaps,
        resume: resumeOf.get(a.student.id) ?? null,
        tests: tests.filter((t) => t.studentId === a.student.id).map(({ studentId: _, ...t }) => t),
        interviews: a.interviews,
      };
    }),
  };
}

async function getManagedApplication(applicationId: string, user: AuthUser) {
  const app = await prisma.jobApplication.findUnique({ where: { id: applicationId }, select: { id: true, jobId: true, status: true } });
  if (!app) throw new HttpError(404, "Application not found");
  await assertCanManageJob(app.jobId, user);
  return app;
}

export async function setApplicationStatus(applicationId: string, status: z.infer<typeof statusSchema>["status"], user: AuthUser) {
  const app = await getManagedApplication(applicationId, user);
  if (app.status === "WITHDRAWN") throw new HttpError(409, "The student withdrew this application");
  const updated = await prisma.jobApplication.update({ where: { id: applicationId }, data: { status }, include: { student: { select: { email: true } } } });
  if (status !== app.status) await enqueueEmail("application-update", updated.student.email, { applicationId });
  return updated;
}

export async function scheduleInterview(applicationId: string, input: z.infer<typeof interviewSchema>, user: AuthUser) {
  const app = await getManagedApplication(applicationId, user);
  if (["WITHDRAWN", "REJECTED", "HIRED"].includes(app.status)) throw new HttpError(409, `Can't schedule an interview: the application is ${app.status.toLowerCase()}`);
  if (input.scheduledAt < new Date()) throw new HttpError(400, "Pick a time in the future", { scheduledAt: "In the past" });
  const interview = await prisma.$transaction(async (tx) => {
    const created = await tx.interview.create({ data: { ...input, applicationId } });
    if (app.status === "APPLIED" || app.status === "SHORTLISTED") await tx.jobApplication.update({ where: { id: applicationId }, data: { status: "INTERVIEW" } });
    return created;
  });
  const student = await prisma.jobApplication.findUniqueOrThrow({ where: { id: applicationId }, select: { student: { select: { email: true } } } });
  await enqueueEmail("interview-scheduled", student.student.email, { interviewId: interview.id });
  return interview;
}

export async function updateInterview(interviewId: string, input: z.infer<typeof interviewUpdateSchema>, user: AuthUser) {
  const interview = await prisma.interview.findUnique({ where: { id: interviewId }, select: { applicationId: true, scheduledAt: true } });
  if (!interview) throw new HttpError(404, "Interview not found");
  await getManagedApplication(interview.applicationId, user);
  const updated = await prisma.interview.update({ where: { id: interviewId }, data: input, include: { application: { select: { student: { select: { email: true } } } } } });
  // Moved to a new time: tell the student.
  if (input.scheduledAt && input.scheduledAt.getTime() !== interview.scheduledAt.getTime()) {
    await enqueueEmail("interview-scheduled", updated.application.student.email, { interviewId });
  }
  const { application: _, ...rest } = updated;
  return rest;
}

// ---------- Talent pool

/** Students who chose to share their profile, ranked by readiness. */
export async function talentPool(query: z.infer<typeof talentQuery>, user: AuthUser) {
  if (!isManager(user)) throw new HttpError(403, "Not allowed");
  const students = await prisma.user.findMany({
    where: {
      role: "STUDENT",
      isActive: true,
      shareProfile: true,
      ...(query.batchId && { batchId: query.batchId }),
      ...(query.q && { OR: [{ name: { contains: query.q, mode: "insensitive" } }, { email: { contains: query.q, mode: "insensitive" } }] }),
    },
    select: { id: true, name: true, email: true, batchId: true, batch: { select: { name: true, course: true } } },
    take: 500,
  });
  const [readiness, resumes] = await Promise.all([readinessFor(students), latestResume(students.map((s) => s.id))]);
  const resumeOf = new Map<string, { id: string; originalName: string }>();
  for (const r of resumes) if (!resumeOf.has(r.ownerId)) resumeOf.set(r.ownerId, { id: r.id, originalName: r.originalName });
  const skill = query.skill?.toLowerCase();

  return {
    items: students
      .map((s) => ({ student: { id: s.id, name: s.name, email: s.email, batch: s.batch }, ...readiness.get(s.id)!, resume: resumeOf.get(s.id) ?? null }))
      .filter((x) => query.minReadiness == null || (x.readiness ?? 0) >= query.minReadiness)
      .filter((x) => !skill || x.strengths.some((st) => st.toLowerCase().includes(skill)))
      .sort((a, b) => (b.readiness ?? -1) - (a.readiness ?? -1)),
  };
}

/** Batches recruiters can aim a campus drive at, or filter the talent pool by. */
export async function batchOptions(user: AuthUser) {
  if (!isManager(user)) throw new HttpError(403, "Not allowed");
  return prisma.batch.findMany({ select: { id: true, name: true, course: true }, orderBy: { startDate: "desc" } });
}

// ---------- Used by quizzes: who may take a job's hiring test

export async function assertCanTakeJobTest(jobId: string, user: AuthUser) {
  const app = await prisma.jobApplication.findUnique({ where: { jobId_studentId: { jobId, studentId: user.id } }, select: { status: true } });
  if (!app || ["WITHDRAWN", "REJECTED"].includes(app.status)) throw new HttpError(404, "Quiz not found");
}

/** Recruiters may see a student's resume if the student shares their profile or applied to one of their jobs. */
export async function recruiterCanSeeStudent(studentId: string, user: AuthUser) {
  if (user.role !== "RECRUITER") return false;
  const s = await prisma.user.findUnique({
    where: { id: studentId },
    select: { shareProfile: true, role: true, applications: { where: { job: { postedById: user.id } }, select: { id: true }, take: 1 } },
  });
  return !!s && s.role === "STUDENT" && (s.shareProfile || s.applications.length > 0);
}

