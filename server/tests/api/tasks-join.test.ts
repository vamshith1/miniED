import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, closeApp, createUser, ymd } from "../helpers.js";

afterAll(closeApp);

type Session = Awaited<ReturnType<typeof createUser>>;
let admin: Session, mentor: Session, otherMentor: Session, student: Session, newcomer: Session;
let batchId: string;

beforeAll(async () => {
  admin = await createUser("ADMIN");
  mentor = await createUser("MENTOR");
  otherMentor = await createUser("MENTOR");
  batchId = (await as(admin.token).post("/batches", { name: `TJ-${Date.now()}`, course: "Web", startDate: ymd(-5), mentorId: mentor.user.id })).body.batch.id;
  student = await createUser("STUDENT", { batchId });
  newcomer = await createUser("STUDENT"); // signed up, not in a batch yet
});

describe("join codes", () => {
  it("lets a student without a batch join with the code, and hides the code from students", async () => {
    expect((await as(otherMentor.token).post(`/batches/${batchId}/join-code`)).status).toBe(404); // not their batch
    const made = await as(mentor.token).post(`/batches/${batchId}/join-code`);
    expect(made.status).toBe(200);
    const code: string = made.body.batch.joinCode;
    expect(code).toMatch(/^[A-Z2-9]{8}$/);

    expect((await as(student.token).get(`/batches/${batchId}`)).body.batch.joinCode).toBeNull();

    expect((await as(newcomer.token).post("/batches/join", { code: "WRONG123" })).status).toBe(404);
    // Case and dashes don't matter.
    const joined = await as(newcomer.token).post("/batches/join", { code: `${code.slice(0, 4).toLowerCase()}-${code.slice(4)}` });
    expect(joined.status).toBe(200);
    expect(joined.body.batchId).toBe(batchId);
    expect((await as(newcomer.token).get("/auth/me")).body.user.batchId).toBe(batchId);

    // Already in a batch now.
    expect((await as(newcomer.token).post("/batches/join", { code })).status).toBe(409);
    expect((await as(admin.token).post("/batches/join", { code })).status).toBe(403);
  });

  it("stops working once turned off or replaced", async () => {
    const old = (await as(mentor.token).post(`/batches/${batchId}/join-code`)).body.batch.joinCode;
    const fresh = (await as(mentor.token).post(`/batches/${batchId}/join-code`)).body.batch.joinCode;
    expect(fresh).not.toBe(old);
    const late = await createUser("STUDENT");
    expect((await as(late.token).post("/batches/join", { code: old })).status).toBe(404);
    expect((await as(mentor.token).delete(`/batches/${batchId}/join-code`)).body.batch.joinCode).toBeNull();
    expect((await as(late.token).post("/batches/join", { code: fresh })).status).toBe(404);
  });
});

describe("tasks", () => {
  let taskId: string;

  it("mentors set tasks; students in the batch see them", async () => {
    const bad = await as(mentor.token).post("/tasks", { batchId, title: "x" });
    expect(bad.status).toBe(400);
    expect((await as(otherMentor.token).post("/tasks", { batchId, title: "Not mine" })).status).toBe(404);
    expect((await as(student.token).post("/tasks", { batchId, title: "Student task" })).status).toBe(403);

    const created = await as(mentor.token).post("/tasks", { batchId, title: "Build a todo app", description: "React + API", dueAt: new Date(Date.now() - 3600_000).toISOString(), maxPoints: 10 });
    expect(created.status).toBe(201);
    taskId = created.body.task.id;

    const mine = await as(student.token).get("/tasks");
    expect(mine.body.items.find((t: { id: string }) => t.id === taskId).mySubmission).toBeNull();
  });

  it("students hand in a link or note; only http(s) links are allowed", async () => {
    expect((await as(student.token).put(`/tasks/${taskId}/submission`, {})).status).toBe(400);
    expect((await as(student.token).put(`/tasks/${taskId}/submission`, { link: "javascript:alert(1)" })).status).toBe(400);
    const ok = await as(student.token).put(`/tasks/${taskId}/submission`, { link: "https://github.com/me/todo", note: "Done" });
    expect(ok.status).toBe(200);
    expect(ok.body.submission.status).toBe("SUBMITTED");

    const list = await as(student.token).get("/tasks");
    expect(list.body.items.find((t: { id: string }) => t.id === taskId).mySubmission.late).toBe(true); // due an hour ago
  });

  it("mentors review: send back, then accept with points; accepted work is final", async () => {
    const subs = await as(mentor.token).get(`/tasks/${taskId}/submissions`);
    expect(subs.status).toBe(200);
    const row = subs.body.items.find((i: { student: { id: string } }) => i.student.id === student.user.id);
    const sid = row.submission.id;

    const back = await as(mentor.token).patch(`/tasks/${taskId}/submissions/${sid}`, { status: "CHANGES_REQUESTED", feedback: "Add tests" });
    expect(back.body.submission.status).toBe("CHANGES_REQUESTED");
    expect((await as(student.token).put(`/tasks/${taskId}/submission`, { link: "https://github.com/me/todo/v2" })).status).toBe(200);

    expect((await as(mentor.token).patch(`/tasks/${taskId}/submissions/${sid}`, { status: "ACCEPTED", points: 11 })).status).toBe(400);
    const accepted = await as(mentor.token).patch(`/tasks/${taskId}/submissions/${sid}`, { status: "ACCEPTED", points: 9, feedback: "Nice" });
    expect(accepted.body.submission).toMatchObject({ status: "ACCEPTED", points: 9 });
    expect((await as(student.token).put(`/tasks/${taskId}/submission`, { note: "again" })).status).toBe(409);

    const overview = await as(mentor.token).get(`/tasks?batchId=${batchId}`);
    expect(overview.body.items[0]).toMatchObject({ submitted: 1, accepted: 1, toReview: 0 });
    // Points are given, so the maximum is locked.
    expect((await as(mentor.token).patch(`/tasks/${taskId}`, { maxPoints: 20 })).status).toBe(409);
  });
});
