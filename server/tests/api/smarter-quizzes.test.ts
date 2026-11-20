import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, closeApp, createUser, ymd } from "../helpers.js";

afterAll(closeApp);

type Session = Awaited<ReturnType<typeof createUser>>;
let admin: Session, mentor: Session, student: Session;
let batchId: string;

beforeAll(async () => {
  admin = await createUser("ADMIN");
  mentor = await createUser("MENTOR");
  batchId = (await as(admin.token).post("/batches", { name: `SQ-${Date.now()}`, course: "Data", startDate: ymd(-5), mentorId: mentor.user.id })).body.batch.id;
  student = await createUser("STUDENT", { batchId });
});

// Option 0 is always the right one.
const q = (text: string, skill: string | null, points = 4) => ({
  text,
  points,
  skill,
  explanation: `Because ${text} is answered by option A`,
  options: [
    { text: "A", isCorrect: true },
    { text: "B", isCorrect: false },
    { text: "C", isCorrect: false },
  ],
});

async function publish(body: object) {
  const created = await as(mentor.token).post("/quizzes", { batchId, durationSeconds: 300, ...body });
  expect(created.status).toBe(201);
  expect((await as(mentor.token).post(`/quizzes/${created.body.quiz.id}/publish`)).status).toBe(200);
  return created.body.quiz as { id: string };
}

type Opt = { id: string; text: string };
type Qs = { id: string; options: Opt[] }[];
const right = (qs: Qs, i: number) => ({ questionId: qs[i].id, optionId: qs[i].options.find((o) => o.text === "A")!.id });
const wrong = (qs: Qs, i: number) => ({ questionId: qs[i].id, optionId: qs[i].options.find((o) => o.text === "B")!.id });
const skip = (qs: Qs, i: number) => ({ questionId: qs[i].id, optionId: null });

describe("negative marking, pass marks and explanations", () => {
  it("takes 25% off for a wrong answer, nothing for a skip, and reports pass/fail", async () => {
    const quiz = await publish({
      title: "SQL test",
      negativePercent: 25,
      passPercent: 50,
      questions: [q("joins", "SQL joins"), q("group by", "Aggregation"), q("left join", "SQL joins"), q("having", "Aggregation")],
    });
    const start = await as(student.token).post(`/quizzes/${quiz.id}/start`);
    expect(start.status).toBe(200);
    expect(start.body.quiz.negativePercent).toBe(25);
    const qs = start.body.questions as Qs;
    // Students never see the explanation or the right answer before submitting.
    expect(JSON.stringify(start.body)).not.toContain("Because");
    expect(JSON.stringify(start.body)).not.toContain("isCorrect");

    // 2 right (+8), 1 wrong (−1), 1 skipped (0) → 7 of 16 = 43.75%, under the 50% pass mark.
    const res = await as(student.token).post(`/quizzes/${quiz.id}/submit`, { answers: [right(qs, 0), wrong(qs, 1), right(qs, 2), skip(qs, 3)] });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ score: 7, maxScore: 16, correct: 2, wrong: 1, skipped: 1, passed: false, passPercent: 50 });
    expect(res.body.review[0].explanation).toContain("Because joins");
    expect(res.body.review[0].skill).toBe("SQL joins");

    // The skill report: SQL joins 2/2, Aggregation 0/2 (one wrong, one skipped) → a gap.
    const skills = await as(student.token).get("/progress/skills");
    expect(skills.status).toBe(200);
    const bySkill = Object.fromEntries(skills.body.skills.map((s: { skill: string }) => [s.skill, s]));
    expect(bySkill["SQL joins"]).toMatchObject({ questions: 2, correct: 2, accuracy: 100, level: "STRONG" });
    expect(bySkill["Aggregation"]).toMatchObject({ questions: 2, correct: 0, wrong: 1, skipped: 1, level: "GAP" });
    expect(skills.body.gaps).toEqual(["Aggregation"]);
    expect(skills.body.skills[0].skill).toBe("Aggregation"); // weakest first

    const history = await as(student.token).get("/progress/quizzes");
    expect(history.body.items[0]).toMatchObject({ passed: false, passPercent: 50 });
  });

  it("never lets the total go below zero", async () => {
    const quiz = await publish({ title: "Harsh", negativePercent: 100, questions: [q("a", null), q("b", null)] });
    const qs = (await as(student.token).post(`/quizzes/${quiz.id}/start`)).body.questions as Qs;
    const res = await as(student.token).post(`/quizzes/${quiz.id}/submit`, { answers: [wrong(qs, 0), wrong(qs, 1)] });
    expect(res.body.score).toBe(0);
    expect(res.body.passed).toBeNull(); // no pass mark set
  });

  it("validates the new settings", async () => {
    const bad = await as(mentor.token).post("/quizzes", { batchId, title: "Bad", durationSeconds: 300, negativePercent: 150, passPercent: 0 });
    expect(bad.status).toBe(400);
  });
});

describe("practice quizzes", () => {
  it("can be taken again and again, shows answers each time, and never reaches the leaderboard", async () => {
    const quiz = await publish({ title: "Warm-up", mode: "PRACTICE", questions: [q("x", "Basics", 1), q("y", "Basics", 1)] });

    // It isn't a test: the timed endpoints refuse it.
    expect((await as(student.token).post(`/quizzes/${quiz.id}/start`)).status).toBe(409);

    const session = await as(student.token).get(`/quizzes/${quiz.id}/practice`);
    expect(session.status).toBe(200);
    expect(session.body.runs).toEqual([]);
    const qs = session.body.questions as Qs;

    const first = await as(student.token).post(`/quizzes/${quiz.id}/practice`, { answers: [right(qs, 0), wrong(qs, 1)], timeTakenMs: 12_000 });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ score: 1, maxScore: 2, correct: 1, wrong: 1 });
    expect(first.body.review[1].explanation).toContain("Because y");

    const second = await as(student.token).post(`/quizzes/${quiz.id}/practice`, { answers: [right(qs, 0), right(qs, 1)] });
    expect(second.body.score).toBe(2);
    expect(second.body.runs).toHaveLength(2);

    const list = await as(student.token).get("/quizzes");
    const item = list.body.items.find((i: { id: string }) => i.id === quiz.id);
    expect(item.myPractice).toEqual({ runs: 2, bestPercentage: 100 });
    expect(item.myAttempt).toBeNull();

    const board = await as(student.token).get(`/quizzes/${quiz.id}/leaderboard`);
    expect(board.body.entries).toEqual([]);
  });

  it("isn't open to tests' practice endpoints", async () => {
    const test = await publish({ title: "Real test", questions: [q("z", null)] });
    expect((await as(student.token).get(`/quizzes/${test.id}/practice`)).status).toBe(409);
  });
});
