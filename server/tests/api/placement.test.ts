import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { readinessScore } from "../../src/modules/placement/placement.service.js";
import { as, closeApp, createUser, ymd } from "../helpers.js";
import { toCsv } from "../../src/lib/csv.js";

afterAll(closeApp);

describe("readiness score", () => {
  it("weighs quizzes 50, attendance 30, tasks 20, and skips parts with no data", () => {
    expect(readinessScore({ quizzes: 80, attendance: 100, tasks: 50 })).toBe(80); // 40 + 30 + 10
    expect(readinessScore({ quizzes: 80, attendance: 100, tasks: null })).toBe(87.5); // (40 + 30) / 80%
    expect(readinessScore({ quizzes: null, attendance: null, tasks: null })).toBeNull();
  });

  it("CSV cells can't run as spreadsheet formulas", () => {
    const csv = toCsv(["a", "b"], [["=HYPERLINK(1)", 'say "hi", ok'], [-5, null]]);
    expect(csv).toContain("'=HYPERLINK(1)");
    expect(csv).toContain('"say ""hi"", ok"');
    expect(csv).toContain("\r\n-5,\r\n"); // real numbers stay numbers
  });
});

describe("placement API", () => {
  type Session = Awaited<ReturnType<typeof createUser>>;
  let admin: Session, mentor: Session, otherMentor: Session, strong: Session, weak: Session, fresh: Session;
  let batchId: string;

  beforeAll(async () => {
    admin = await createUser("ADMIN");
    mentor = await createUser("MENTOR");
    otherMentor = await createUser("MENTOR");
    batchId = (await as(admin.token).post("/batches", { name: `PL-${Date.now()}`, course: "Web", startDate: ymd(-10), mentorId: mentor.user.id })).body.batch.id;
    strong = await createUser("STUDENT", { name: "Strong Student", batchId });
    weak = await createUser("STUDENT", { name: "Weak Student", batchId });
    fresh = await createUser("STUDENT", { name: "=Fresh Student", batchId });

    // Attendance: strong 2/2, weak 1/2.
    for (const [day, weakStatus] of [[ymd(-2), "ABSENT"], [ymd(-1), "PRESENT"]] as const) {
      await as(mentor.token).put(`/batches/${batchId}/attendance`, {
        date: day,
        records: [
          { studentId: strong.user.id, status: "PRESENT" },
          { studentId: weak.user.id, status: weakStatus },
        ],
      });
    }
    // A quiz: strong gets it right, weak gets it wrong. Tagged with a skill.
    const quiz = (
      await as(mentor.token).post("/quizzes", {
        batchId,
        title: "Basics",
        durationSeconds: 300,
        questions: [{ text: "2+2", points: 1, skill: "Arithmetic", options: [{ text: "4", isCorrect: true }, { text: "5", isCorrect: false }] }],
      })
    ).body.quiz;
    await as(mentor.token).post(`/quizzes/${quiz.id}/publish`);
    for (const [s, pick] of [[strong, "4"], [weak, "5"]] as const) {
      const q = (await as(s.token).post(`/quizzes/${quiz.id}/start`)).body.questions[0];
      await as(s.token).post(`/quizzes/${quiz.id}/submit`, { answers: [{ questionId: q.id, optionId: q.options.find((o: { text: string }) => o.text === pick).id }] });
    }
    // A task that's due, accepted for strong only.
    const task = (await as(mentor.token).post("/tasks", { batchId, title: "Homework", dueAt: new Date(Date.now() - 60_000).toISOString() })).body.task;
    await as(strong.token).put(`/tasks/${task.id}/submission`, { note: "done" });
    const sub = await prisma.taskSubmission.findFirstOrThrow({ where: { taskId: task.id } });
    await as(mentor.token).patch(`/tasks/${task.id}/submissions/${sub.id}`, { status: "ACCEPTED" });
  });

  it("ranks the batch by readiness and lists what to teach next", async () => {
    expect((await as(otherMentor.token).get(`/placement/batches/${batchId}`)).status).toBe(404);
    expect((await as(strong.token).get(`/placement/batches/${batchId}`)).status).toBe(403);

    const res = await as(mentor.token).get(`/placement/batches/${batchId}`);
    expect(res.status).toBe(200);
    const [first, second, third] = res.body.items;
    expect(first.student.name).toBe("Strong Student");
    expect(first).toMatchObject({ readiness: 100, band: "READY", quizAverage: 100, attendance: 100, tasksAccepted: 1, tasksDue: 1 });
    // weak: quiz 0 (×50) + attendance 50 (×30) + tasks 0 (×20) = 15
    expect(second).toMatchObject({ readiness: 15, band: "NEEDS_WORK", gaps: ["Arithmetic"] });
    // fresh: nothing to score yet except tasks (0 of 1 due).
    expect(third.student.name).toBe("=Fresh Student");
    expect(res.body.summary).toMatchObject({ students: 3, ready: 1, topGaps: [{ skill: "Arithmetic", students: 1 }] });

    const overview = await as(admin.token).get("/placement/batches");
    expect(overview.body.items.find((b: { id: string }) => b.id === batchId)).toMatchObject({ students: 3, ready: 1 });
  });

  it("exports a CSV, and students see their own readiness", async () => {
    const csv = await as(mentor.token).get(`/placement/batches/${batchId}/report.csv`);
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.headers["content-disposition"]).toContain("attachment");
    expect(csv.text).toContain("Strong Student");
    expect(csv.text).toContain("'=Fresh Student");

    const me = await as(weak.token).get("/placement/me");
    expect(me.body).toMatchObject({ readiness: 15, band: "NEEDS_WORK", weights: { quizzes: 50, attendance: 30, tasks: 20 } });
  });
});
