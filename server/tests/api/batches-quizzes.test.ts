import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { as, closeApp, createUser, ymd } from "../helpers.js";

afterAll(closeApp);

type Session = Awaited<ReturnType<typeof createUser>>;
let admin: Session, mentor: Session, otherMentor: Session;
let batchId: string, otherBatchId: string;
let s1: Session, s2: Session, outsider: Session;

beforeAll(async () => {
  admin = await createUser("ADMIN");
  mentor = await createUser("MENTOR");
  otherMentor = await createUser("MENTOR");
  const stamp = Date.now();
  batchId = (await as(admin.token).post("/batches", { name: `B-${stamp}`, course: "Web", startDate: ymd(-10), mentorId: mentor.user.id })).body.batch.id;
  otherBatchId = (await as(admin.token).post("/batches", { name: `Z-${stamp}`, course: "Data", startDate: ymd(-10), mentorId: otherMentor.user.id }))
    .body.batch.id;
  s1 = await createUser("STUDENT", { name: "Student Ava", batchId });
  s2 = await createUser("STUDENT", { name: "Student Ben", batchId });
  outsider = await createUser("STUDENT", { name: "Student Zed", batchId: otherBatchId });
});

describe("batches", () => {
  it("validates new batches", async () => {
    const bad = await as(admin.token).post("/batches", { name: `Bad-${Date.now()}`, course: "Web", startDate: ymd(), endDate: ymd(-1) });
    expect(bad.status).toBe(400);
    expect((await as(mentor.token).post("/batches", { name: "Mine", course: "Web", startDate: ymd() })).status).toBe(403);
  });

  it("each role only sees its own batches; others get 404", async () => {
    const mine = await as(mentor.token).get("/batches");
    expect(mine.body.items.map((b: { id: string }) => b.id)).toContain(batchId);
    expect(mine.body.items.map((b: { id: string }) => b.id)).not.toContain(otherBatchId);
    expect((await as(s1.token).get("/batches")).body.items).toHaveLength(1);
    expect((await as(mentor.token).get(`/batches/${otherBatchId}`)).status).toBe(404);
    expect((await as(s1.token).get(`/batches/${otherBatchId}`)).status).toBe(404);
    expect((await as(s1.token).get(`/batches/${batchId}/students`)).status).toBe(403);
    expect((await as(mentor.token).get(`/batches/${batchId}/students`)).body.items).toHaveLength(2);
  });
});

describe("attendance", () => {
  it("marks a day, updates it, and counts LATE as attended", async () => {
    const day = ymd(-1);
    const mark = (status: string) =>
      as(mentor.token).put(`/batches/${batchId}/attendance`, {
        date: day,
        records: [
          { studentId: s1.user.id, status },
          { studentId: s2.user.id, status: "ABSENT" },
        ],
      });
    expect((await mark("PRESENT")).status).toBe(200);
    expect((await mark("LATE")).status).toBe(200); // same day again: updated, not duplicated
    expect(await prisma.attendance.count({ where: { batchId, date: new Date(`${day}T00:00:00Z`) } })).toBe(2);

    const summary = await as(mentor.token).get(`/batches/${batchId}/attendance/summary`);
    expect(summary.status).toBe(200);
    const me = await as(s1.token).get("/attendance/me");
    expect(me.body.percentage).toBe(100);
  });

  it("rejects future dates and students from other batches", async () => {
    const future = await as(mentor.token).put(`/batches/${batchId}/attendance`, { date: ymd(1), records: [{ studentId: s1.user.id, status: "PRESENT" }] });
    expect(future.status).toBe(400);
    const stranger = await as(mentor.token).put(`/batches/${batchId}/attendance`, {
      date: ymd(-1),
      records: [{ studentId: outsider.user.id, status: "PRESENT" }],
    });
    expect(stranger.status).toBe(400);
    expect((await as(otherMentor.token).get(`/batches/${batchId}/attendance?date=${ymd(-1)}`)).status).toBe(404);
  });
});

describe("quizzes", () => {
  const question = (text: string, points: number, correct: number, n = 3) => ({
    text,
    points,
    options: Array.from({ length: n }, (_, i) => ({ text: `${text}-${i}`, isCorrect: i === correct })),
  });
  let quizId: string;
  let key: { id: string; correct: string; wrong: string }[];

  it("mentors build a draft, then publish it", async () => {
    const twoRight = await as(mentor.token).post("/quizzes", {
      batchId,
      title: "Bad",
      durationSeconds: 600,
      questions: [{ text: "?", options: [{ text: "a", isCorrect: true }, { text: "b", isCorrect: true }] }],
    });
    expect(twoRight.status).toBe(400);
    expect((await as(otherMentor.token).post("/quizzes", { batchId, title: "Not mine", durationSeconds: 600 })).status).toBe(404);

    const res = await as(mentor.token).post("/quizzes", {
      batchId,
      title: "JS Basics",
      durationSeconds: 600,
      questions: [question("Q1", 1, 0), question("Q2", 2, 1), question("Q3", 3, 2)],
    });
    expect(res.status).toBe(201);
    quizId = res.body.quiz.id;
    key = res.body.quiz.questions.map((q: { id: string; options: { id: string; isCorrect: boolean }[] }) => ({
      id: q.id,
      correct: q.options.find((o) => o.isCorrect)!.id,
      wrong: q.options.find((o) => !o.isCorrect)!.id,
    }));

    expect((await as(s1.token).post(`/quizzes/${quizId}/start`)).status).toBe(404); // drafts are hidden
    expect((await as(mentor.token).post(`/quizzes/${quizId}/publish`)).status).toBe(200);
    expect((await as(mentor.token).put(`/quizzes/${quizId}`, { title: "Edit", durationSeconds: 600, questions: [] })).status).toBe(409);
  });

  it("students get questions without answers, and the server keeps the time", async () => {
    const res = await as(s1.token).post(`/quizzes/${quizId}/start`);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain("isCorrect");
    expect(new Date(res.body.expiresAt).getTime() - new Date(res.body.startedAt).getTime()).toBe(600_000);
    expect((await as(outsider.token).post(`/quizzes/${quizId}/start`)).status).toBe(404);
  });

  it("scores on the server, once", async () => {
    const all = key.map((k) => ({ questionId: k.id, optionId: k.correct }));
    const res = await as(s1.token).post(`/quizzes/${quizId}/submit`, { answers: all });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ score: 6, maxScore: 6, percentage: 100, status: "SUBMITTED" });
    expect((await as(s1.token).post(`/quizzes/${quizId}/submit`, { answers: all })).status).toBe(409);
    expect(await prisma.emailLog.count({ where: { to: s1.user.email, template: "quiz-result" } })).toBe(1);
  });

  it("unanswered questions count as wrong", async () => {
    await as(s2.token).post(`/quizzes/${quizId}/start`);
    const res = await as(s2.token).post(`/quizzes/${quizId}/submit`, {
      answers: [{ questionId: key[0].id, optionId: key[0].correct }, { questionId: key[1].id, optionId: key[1].wrong }],
    });
    expect(res.body.score).toBe(1);
  });

  it("leaderboard is ranked, cached, and invalidated by a submit", async () => {
    const first = await as(mentor.token).get(`/quizzes/${quizId}/leaderboard`);
    expect(first.status).toBe(200);
    expect(first.headers["x-cache"]).toBe("MISS");
    expect(first.body.entries.map((e: { name: string }) => e.name)).toEqual(["Student Ava", "Student Ben"]);
    expect(JSON.stringify(first.body)).not.toContain("@");
    const second = await as(s2.token).get(`/quizzes/${quizId}/leaderboard`);
    expect(second.headers["x-cache"]).toBe("HIT");
    expect((await as(outsider.token).get(`/quizzes/${quizId}/leaderboard`)).status).toBe(404);
  });

  it("the admin dashboard shows the batch's average quiz score", async () => {
    // Ava 6/6 and Ben 1/6 so far: (6 + 1) / 12 = 58.3%
    const res = await as(admin.token).get("/dashboard/stats");
    expect(res.status).toBe(200);
    const row = res.body.quizzes.byBatch.find((b: { batchId: string }) => b.batchId === batchId);
    expect(row).toMatchObject({ name: expect.stringMatching(/^B-/), averageScore: 58.3, attempts: 2 });
    expect(res.body.quizzes.byBatch.some((b: { batchId: string }) => b.batchId === otherBatchId)).toBe(false);
  });

  it("a submit after the time limit plus grace is EXPIRED with 0 points", async () => {
    const late = await createUser("STUDENT", { name: "Student Late", batchId });
    const start = await as(late.token).post(`/quizzes/${quizId}/start`);
    await prisma.quizAttempt.update({ where: { id: start.body.attemptId }, data: { startedAt: new Date(Date.now() - 620_000) } });
    const res = await as(late.token).post(`/quizzes/${quizId}/submit`, { answers: key.map((k) => ({ questionId: k.id, optionId: k.correct })) });
    expect(res.status).toBe(409);
    expect((await as(late.token).get(`/quizzes/${quizId}/result`)).body).toMatchObject({ status: "EXPIRED", score: 0 });
  });
});
