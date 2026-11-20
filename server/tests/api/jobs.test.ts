import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { as, closeApp, createUser, uniqueEmail, ymd, PASSWORD, login } from "../helpers.js";

afterAll(closeApp);

type Session = Awaited<ReturnType<typeof createUser>>;
let admin: Session, recruiter: Session, otherRecruiter: Session, mentor: Session;
let inBatch: Session, otherBatch: Session, sharer: Session;
let batchId: string, otherBatchId: string;

const pdf = Buffer.from("%PDF-1.4\n% test resume\n");

async function newRecruiter(company: string) {
  const email = uniqueEmail("recruiter");
  const res = await as(admin.token).post("/users", { name: `${company} HR`, email, password: PASSWORD, role: "RECRUITER", company });
  expect(res.status).toBe(201);
  return login(email, PASSWORD);
}

beforeAll(async () => {
  admin = await createUser("ADMIN");
  mentor = await createUser("MENTOR");
  const stamp = Date.now();
  batchId = (await as(admin.token).post("/batches", { name: `J-${stamp}`, course: "Web", startDate: ymd(-5), mentorId: mentor.user.id })).body.batch.id;
  otherBatchId = (await as(admin.token).post("/batches", { name: `K-${stamp}`, course: "Data", startDate: ymd(-5) })).body.batch.id;
  recruiter = await newRecruiter("Acme");
  otherRecruiter = await newRecruiter("Globex");
  inBatch = await createUser("STUDENT", { name: "In Batch", batchId });
  otherBatch = await createUser("STUDENT", { name: "Other Batch", batchId: otherBatchId });
  sharer = await createUser("STUDENT", { name: "Sharer", batchId: otherBatchId });
});

describe("recruiter accounts", () => {
  it("need a company, and can't use the institute's pages", async () => {
    const bad = await as(admin.token).post("/users", { name: "No Co", email: uniqueEmail("r"), password: PASSWORD, role: "RECRUITER" });
    expect(bad.status).toBe(400);
    expect((await as(recruiter.token).get("/auth/me")).body.user).toMatchObject({ role: "RECRUITER", company: "Acme" });
    expect((await as(recruiter.token).get("/leads")).status).toBe(403);
    expect((await as(recruiter.token).get(`/placement/batches/${batchId}`)).status).toBe(403);
  });
});

describe("jobs and campus drives", () => {
  let openJob: string, drive: string, picky: string;

  it("recruiters post jobs; a campus drive is only for its batches", async () => {
    const job = await as(recruiter.token).post("/jobs", { title: "Junior Developer", description: "Build web apps with React", skills: ["React", "React", "SQL"], salary: "₹6 LPA" });
    expect(job.status).toBe(201);
    expect(job.body.job).toMatchObject({ company: "Acme", isCampusDrive: false, skills: ["React", "SQL"] });
    openJob = job.body.job.id;

    const d = await as(recruiter.token).post("/jobs", { title: "Campus Intern", type: "INTERNSHIP", description: "Summer internship for the web batch", batchIds: [batchId] });
    expect(d.body.job.isCampusDrive).toBe(true);
    drive = d.body.job.id;

    picky = (await as(recruiter.token).post("/jobs", { title: "Senior", description: "Needs strong readiness", minReadiness: 90 })).body.job.id;

    expect((await as(inBatch.token).post("/jobs", { title: "Mine", description: "Students can't post jobs" })).status).toBe(403);
    // Recruiters only see and manage their own jobs.
    expect((await as(otherRecruiter.token).get("/jobs")).body.items).toHaveLength(0);
    expect((await as(otherRecruiter.token).patch(`/jobs/${openJob}`, { status: "CLOSED" })).status).toBe(404);
  });

  it("students see what they can apply to", async () => {
    const mine = (await as(inBatch.token).get("/jobs")).body.items.map((j: { id: string }) => j.id);
    expect(mine).toEqual(expect.arrayContaining([openJob, drive, picky]));
    const theirs = (await as(otherBatch.token).get("/jobs")).body.items;
    expect(theirs.map((j: { id: string }) => j.id)).not.toContain(drive);
    expect((await as(otherBatch.token).get(`/jobs/${drive}`)).status).toBe(404);
    expect((await as(otherBatch.token).post(`/jobs/${drive}/apply`, {})).status).toBe(409);

    const p = theirs.find((j: { id: string }) => j.id === picky);
    expect(p.canApply).toBe(false);
    expect(p.cannotApplyReason).toContain("90%");
    expect((await as(otherBatch.token).post(`/jobs/${picky}/apply`, {})).status).toBe(409);
  });

  it("applying, the pipeline and interviews", async () => {
    const a = await as(inBatch.token).post(`/jobs/${openJob}/apply`, { coverNote: "I love React" });
    expect(a.status).toBe(201);
    expect((await as(inBatch.token).post(`/jobs/${openJob}/apply`, {})).status).toBe(409);
    const appId = a.body.application.id;

    const list = await as(recruiter.token).get(`/jobs/${openJob}/applicants`);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({ status: "APPLIED", coverNote: "I love React", student: { name: "In Batch" } });
    expect((await as(otherRecruiter.token).get(`/jobs/${openJob}/applicants`)).status).toBe(404);

    expect((await as(recruiter.token).patch(`/jobs/applications/${appId}`, { status: "SHORTLISTED" })).body.application.status).toBe("SHORTLISTED");

    const past = await as(recruiter.token).post(`/jobs/applications/${appId}/interviews`, { scheduledAt: new Date(Date.now() - 3600_000).toISOString() });
    expect(past.status).toBe(400);
    const badLink = await as(recruiter.token).post(`/jobs/applications/${appId}/interviews`, { scheduledAt: new Date(Date.now() + 86_400_000).toISOString(), location: "javascript:alert(1)" });
    expect(badLink.status).toBe(400);
    const iv = await as(recruiter.token).post(`/jobs/applications/${appId}/interviews`, {
      scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
      durationMinutes: 45,
      location: "https://meet.example.com/abc",
      notes: "Bring your portfolio",
    });
    expect(iv.status).toBe(201);
    await as(recruiter.token).patch(`/jobs/interviews/${iv.body.interview.id}`, { outcome: "PASSED", feedback: "Strong" });

    const mine = await as(inBatch.token).get("/jobs/applications/mine");
    const app = mine.body.items.find((x: { id: string }) => x.id === appId);
    expect(app.status).toBe("INTERVIEW"); // scheduling moved it along
    expect(app.interviews[0]).toMatchObject({ outcome: "PASSED", notes: "Bring your portfolio" });
    expect(app.interviews[0].feedback).toBeUndefined(); // the recruiter's notes stay private

    const templates = (await prisma.emailLog.findMany({ where: { to: inBatch.user.email } })).map((e) => e.template);
    expect(templates).toEqual(expect.arrayContaining(["application-update", "interview-scheduled"]));

    expect((await as(inBatch.token).post(`/jobs/${openJob}/withdraw`)).body.application.status).toBe("WITHDRAWN");
    expect((await as(recruiter.token).patch(`/jobs/applications/${appId}`, { status: "OFFERED" })).status).toBe(409);
    // Withdrawn applications can be re-opened by applying again.
    expect((await as(inBatch.token).post(`/jobs/${openJob}/apply`, {})).status).toBe(201);
  });

  it("closed jobs take no new applications", async () => {
    await as(recruiter.token).patch(`/jobs/${drive}`, { status: "CLOSED" });
    expect((await as(inBatch.token).post(`/jobs/${drive}/apply`, {})).status).toBe(409);
  });

  it("hiring tests: only applicants can take them, inside the window, with no public leaderboard", async () => {
    const quiz = await as(recruiter.token).post("/quizzes", {
      jobId: openJob,
      title: "Acme screening",
      durationSeconds: 300,
      questions: [{ text: "HTTP 404 means?", points: 1, options: [{ text: "Not found", isCorrect: true }, { text: "OK", isCorrect: false }] }],
    });
    expect(quiz.status).toBe(201);
    const id = quiz.body.quiz.id;
    expect((await as(otherRecruiter.token).get(`/quizzes/${id}`)).status).toBe(404);
    expect((await as(recruiter.token).post("/quizzes", { batchId, title: "Sneaky", durationSeconds: 60 })).status).toBe(404); // not their batch
    expect((await as(recruiter.token).post(`/quizzes/${id}/publish`)).status).toBe(200);

    expect((await as(otherBatch.token).post(`/quizzes/${id}/start`)).status).toBe(404); // didn't apply
    const start = await as(inBatch.token).post(`/quizzes/${id}/start`);
    expect(start.status).toBe(200);
    expect(start.body.quiz.isHiringTest).toBe(true);
    const q = start.body.questions[0];
    await as(inBatch.token).post(`/quizzes/${id}/submit`, { answers: [{ questionId: q.id, optionId: q.options[0].id }] });
    expect((await as(inBatch.token).get(`/quizzes/${id}/leaderboard`)).status).toBe(404);

    const applicants = await as(recruiter.token).get(`/jobs/${openJob}/applicants`);
    expect(applicants.body.items[0].tests[0]).toMatchObject({ quizId: id, status: "SUBMITTED", maxScore: 1 });

    // Hiring tests don't count towards course readiness.
    const me = await as(inBatch.token).get("/placement/me");
    expect(me.body.quizzesTaken).toBe(0);

    // A test with a future opening time can't be started yet.
    const later = await as(recruiter.token).post("/quizzes", {
      jobId: openJob,
      title: "Round 2",
      durationSeconds: 300,
      opensAt: new Date(Date.now() + 3600_000).toISOString(),
      questions: [{ text: "x", points: 1, options: [{ text: "a", isCorrect: true }, { text: "b", isCorrect: false }] }],
    });
    await as(recruiter.token).post(`/quizzes/${later.body.quiz.id}/publish`);
    const early = await as(inBatch.token).post(`/quizzes/${later.body.quiz.id}/start`);
    expect(early.status).toBe(409);
    expect(early.body.error).toContain("opens at");
  });
});

describe("talent pool", () => {
  it("lists only students who opted in, and lets recruiters open their resume", async () => {
    await as(sharer.token).upload("/documents", pdf, "sharer.pdf", { kind: "RESUME" });
    const docs = await as(sharer.token).get("/documents");
    const resumeId = docs.body.items[0].id;
    expect((await as(otherRecruiter.token).get(`/documents/${resumeId}/download`)).status).toBe(404);

    expect((await as(sharer.token).put("/jobs/profile-sharing", { share: true })).body.shareProfile).toBe(true);
    const pool = await as(otherRecruiter.token).get("/jobs/talent");
    const names = pool.body.items.map((i: { student: { name: string } }) => i.student.name);
    expect(names).toContain("Sharer");
    expect(names).not.toContain("Other Batch");
    expect(pool.body.items.find((i: { student: { name: string } }) => i.student.name === "Sharer").resume.id).toBe(resumeId);

    expect((await as(otherRecruiter.token).get(`/documents/${resumeId}/download`)).status).toBe(200);
    expect((await as(inBatch.token).get("/jobs/talent")).status).toBe(403);

    // Opting out hides them again.
    await as(sharer.token).put("/jobs/profile-sharing", { share: false });
    expect((await as(otherRecruiter.token).get(`/documents/${resumeId}/download`)).status).toBe(404);
  });
});
