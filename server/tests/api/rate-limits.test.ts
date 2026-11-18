import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Local requests normally skip rate limits; this file turns them on. Vitest gives each file
// its own modules, so the app is imported only after the setting changes.
process.env.RATE_LIMIT_LOCAL = "true";
const { as, closeApp, createUser, ymd } = await import("../helpers.js");

afterAll(closeApp);

describe("rate limits", () => {
  let studentToken: string;

  beforeAll(async () => {
    const admin = await createUser("ADMIN");
    const batch = (await as(admin.token).post("/batches", { name: `RL-${Date.now()}`, course: "Web", startDate: ymd(-1) })).body.batch;
    studentToken = (await createUser("STUDENT", { batchId: batch.id })).token;
  });

  it("quiz submit allows 20 per 10 minutes per student, then 429 with Retry-After", async () => {
    // A quiz that doesn't exist still counts: the limit runs before the quiz is looked up.
    for (let i = 0; i < 20; i++) {
      const res = await as(studentToken).post("/quizzes/no-such-quiz/submit", { answers: [] });
      expect(res.status).toBe(404);
    }
    const blocked = await as(studentToken).post("/quizzes/no-such-quiz/submit", { answers: [] });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
    expect(blocked.body.error).toMatch(/quiz submissions/);
  });

  it("each student has their own quiz-submit limit", async () => {
    const admin = await createUser("ADMIN");
    const batch = (await as(admin.token).post("/batches", { name: `RL2-${Date.now()}`, course: "Web", startDate: ymd(-1) })).body.batch;
    const other = await createUser("STUDENT", { batchId: batch.id });
    expect((await as(other.token).post("/quizzes/no-such-quiz/submit", { answers: [] })).status).toBe(404);
  });

  it("login allows 10 tries per 15 minutes per email", async () => {
    const { user } = await createUser("MENTOR"); // signs in once: 1 of the 10 tries
    const statuses: number[] = [];
    for (let i = 0; i < 10; i++) {
      statuses.push((await as(null).post("/auth/login", { email: user.email, password: "Wrong@12345" })).status);
    }
    expect(statuses.slice(0, 9)).toEqual(Array(9).fill(401));
    expect(statuses[9]).toBe(429);
  });
});
