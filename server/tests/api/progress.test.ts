import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { as, closeApp, createUser, ymd } from "../helpers.js";

afterAll(closeApp);

type Session = Awaited<ReturnType<typeof createUser>>;
let admin: Session, ava: Session, ben: Session, cara: Session;
let batchId: string;

// A 2-question quiz (1 + 3 points). Returns its id and the right/wrong option per question.
async function publishQuiz(title: string) {
  const q = (text: string, points: number) => ({ text, points, options: [{ text: "right", isCorrect: true }, { text: "wrong", isCorrect: false }] });
  const created = (await as(admin.token).post("/quizzes", { batchId, title, durationSeconds: 600, questions: [q("Q1", 1), q("Q2", 3)] })).body.quiz;
  await as(admin.token).post(`/quizzes/${created.id}/publish`);
  const key = created.questions.map((x: { id: string; options: { id: string; isCorrect: boolean }[] }) => ({
    id: x.id,
    right: x.options.find((o) => o.isCorrect)!.id,
    wrong: x.options.find((o) => !o.isCorrect)!.id,
  }));
  return { id: created.id as string, key: key as { id: string; right: string; wrong: string }[] };
}

async function take(student: Session, quiz: Awaited<ReturnType<typeof publishQuiz>>, correct: boolean[]) {
  await as(student.token).post(`/quizzes/${quiz.id}/start`);
  const answers = quiz.key.map((k, i) => ({ questionId: k.id, optionId: correct[i] ? k.right : k.wrong }));
  return (await as(student.token).post(`/quizzes/${quiz.id}/submit`, { answers })).body;
}

beforeAll(async () => {
  admin = await createUser("ADMIN");
  batchId = (await as(admin.token).post("/batches", { name: `Prog-${Date.now()}`, course: "Web", startDate: ymd(-20), classMinutes: 120 })).body.batch.id;
  ava = await createUser("STUDENT", { name: "Ava", batchId });
  ben = await createUser("STUDENT", { name: "Ben", batchId });
  cara = await createUser("STUDENT", { name: "Cara", batchId });

  // Ava: present, present, late, absent, present (oldest to newest)
  const marks = ["PRESENT", "PRESENT", "LATE", "ABSENT", "PRESENT"];
  for (let i = 0; i < marks.length; i++) {
    await as(admin.token).put(`/batches/${batchId}/attendance`, { date: ymd(-5 + i), records: [{ studentId: ava.user.id, status: marks[i] }] });
  }

  const first = await publishQuiz("First quiz");
  await take(ava, first, [true, false]); // 1/4
  await take(ben, first, [true, true]); // 4/4
  await take(cara, first, [false, false]); // 0/4
  const second = await publishQuiz("Second quiz");
  await take(ava, second, [true, true]); // 4/4
  await take(ben, second, [false, true]); // 3/4
});

describe("my quizzes", () => {
  it("lists every attempt with marks, rank among classmates and the class average", async () => {
    const res = await as(ava.token).get("/progress/quizzes");
    expect(res.status).toBe(200);
    const [latest, earliest] = res.body.items; // newest first
    expect(latest).toMatchObject({ title: "Second quiz", score: 4, maxScore: 4, percentage: 100, rank: 1, outOf: 2, classAverage: 87.5 });
    expect(earliest).toMatchObject({ title: "First quiz", score: 1, percentage: 25, rank: 2, outOf: 3, classAverage: 41.7 });
    expect(res.body.summary).toMatchObject({ taken: 2, averagePercentage: 62.5, bestPercentage: 100, latestPercentage: 100, firstPlaces: 1 });
    expect(res.body.summary.totalTimeMs).toBeGreaterThanOrEqual(0);
  });

  it("an expired attempt shows 0, uses the full time and has no rank", async () => {
    const late = await createUser("STUDENT", { name: "Late Lee", batchId });
    const quiz = await publishQuiz("Timed out");
    const start = (await as(late.token).post(`/quizzes/${quiz.id}/start`)).body;
    await prisma.quizAttempt.update({ where: { id: start.attemptId }, data: { startedAt: new Date(Date.now() - 700_000) } });
    await as(late.token).post(`/quizzes/${quiz.id}/submit`, { answers: [] });
    const [item] = (await as(late.token).get("/progress/quizzes")).body.items;
    expect(item).toMatchObject({ status: "EXPIRED", score: 0, rank: null, timeTakenMs: 600_000 });
  });
});

describe("my attendance", () => {
  it("gives every day, counts and streaks", async () => {
    const res = await as(ava.token).get("/progress/attendance");
    expect(res.status).toBe(200);
    expect(res.body.records.map((r: { status: string }) => r.status)).toEqual(["PRESENT", "PRESENT", "LATE", "ABSENT", "PRESENT"]);
    expect(res.body.records[0].date).toBe(ymd(-5));
    expect(res.body.summary).toMatchObject({ marked: 5, present: 3, late: 1, absent: 1, percentage: 80, currentStreak: 1, longestStreak: 3 });
    expect(res.body.batch).toMatchObject({ classMinutes: 120, startDate: ymd(-20) });
  });
});

describe("time spent", () => {
  it("adds class time (attended days × class length) and quiz time", async () => {
    const res = await as(ava.token).get("/progress/time");
    expect(res.status).toBe(200);
    expect(res.body.classLengthKnown).toBe(true);
    expect(res.body.totals).toMatchObject({ classMinutes: 480, daysAttended: 4, quizzesTaken: 2 }); // 4 attended days × 120
    expect(res.body.totals.totalMinutes).toBeCloseTo(480 + res.body.totals.quizMinutes, 1);
    expect(res.body.weeks).toHaveLength(12);
    const weekSum = res.body.weeks.reduce((s: number, w: { classMinutes: number }) => s + w.classMinutes, 0);
    expect(weekSum).toBe(480);
  });

  it("doesn't invent class hours when the batch has no class length", async () => {
    await as(admin.token).patch(`/batches/${batchId}`, { classMinutes: null });
    const res = await as(ava.token).get("/progress/time");
    expect(res.body.classLengthKnown).toBe(false);
    expect(res.body.totals.classMinutes).toBeNull();
    expect(res.body.totals.daysAttended).toBe(4);
    await as(admin.token).patch(`/batches/${batchId}`, { classMinutes: 120 });
  });
});

describe("access", () => {
  it("is for students only, and each sees only their own", async () => {
    expect((await as(admin.token).get("/progress/quizzes")).status).toBe(403);
    const mentor = await createUser("MENTOR");
    expect((await as(mentor.token).get("/progress/time")).status).toBe(403);
    const fresh = await createUser("STUDENT");
    const res = await as(fresh.token).get("/progress/attendance");
    expect(res.body.records).toEqual([]);
    expect(res.body.summary.percentage).toBeNull();
    expect((await as(fresh.token).get("/progress/quizzes")).body.items).toEqual([]);
  });
});
