import "dotenv/config";
import { PrismaClient } from "@prisma/client";
// Used only to move an attempt's start time back when testing expiry.
const db = new PrismaClient();

const B = process.env.API_URL ?? "http://localhost:4000/api";
for (let i = 0; i < 60; i++) {
  try { const r = await fetch(B + "/health"); if (r.ok) break; } catch {}
  await new Promise(r => setTimeout(r, 500));
}
let pass = 0, fail = 0;
async function call(method, path, body, token) {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  if (body) headers["content-type"] = "application/json";
  const r = await fetch(B + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  return { status: r.status, cache: r.headers.get("x-cache"), body: text ? JSON.parse(text) : null };
}
function check(name, cond, extra) {
  cond ? pass++ : fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  -> " + JSON.stringify(extra).slice(0, 600)}`);
}
const login = async (email, password) => (await call("POST", "/auth/login", { email, password })).body;
const ymd = (o = 0) => { const d = new Date(); d.setDate(d.getDate() + o); return d.toLocaleDateString("en-CA"); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const run = Date.now();

// ---------- setup: two batches, students
const admin = (await login("admin@miniedcrm.test", "Admin@12345")).token;
const m1 = await login("mentor@miniedcrm.test", "Mentor@12345");
const mentor1 = m1.token;
await call("POST", "/users", { name: "Other Mentor", email: `om.${run}@miniedcrm.test`, password: "Mentor2@123", role: "MENTOR" }, admin);
const om = await login(`om.${run}@miniedcrm.test`, "Mentor2@123");
const batchQ = (await call("POST", "/batches", { name: `Quiz-Q-${run}`, course: "Full Stack Web", startDate: ymd(-7), mentorId: m1.user.id }, admin)).body.batch.id;
const batchZ = (await call("POST", "/batches", { name: `Quiz-Z-${run}`, course: "Data Science", startDate: ymd(-7), mentorId: om.user.id }, admin)).body.batch.id;

async function student(tag, batchId) {
  const lead = (await call("POST", "/leads", { name: `Student ${tag}`, email: `${tag}.${run}@quiz.test` }, admin)).body.lead;
  await call("POST", `/leads/${lead.id}/convert`, { batchId, password: "Student@123" }, admin);
  return (await login(lead.email, "Student@123")).token;
}
const s1 = await student("ava", batchQ);
const s2 = await student("ben", batchQ);
const s3 = await student("cara", batchQ);
const s4 = await student("dev", batchQ);
const outsider = await student("zed", batchZ);

// ---------- builder
const q = (text, points, correctIdx, n = 4) => ({ text, points, options: Array.from({ length: n }, (_, i) => ({ text: `${text} option ${i + 1}`, isCorrect: i === correctIdx })) });
let r = await call("POST", "/quizzes", { batchId: batchQ, title: "Draft title", durationSeconds: 600, questions: [q("Q1", 1, 0)] }, mentor1);
check("mentor creates draft quiz -> 201", r.status === 201 && r.body.quiz.isPublished === false, r);
const quizId = r.body.quiz?.id;

r = await call("POST", "/quizzes", { batchId: batchQ, title: "Bad", durationSeconds: 600, questions: [{ text: "Two right", options: [{ text: "a", isCorrect: true }, { text: "b", isCorrect: true }] }] }, mentor1);
check("two correct options -> 400", r.status === 400, r);
r = await call("POST", "/quizzes", { batchId: batchQ, title: "Bad", durationSeconds: 600, questions: [{ text: "One option", options: [{ text: "a", isCorrect: true }] }] }, mentor1);
check("only one option -> 400", r.status === 400, r);
r = await call("POST", "/quizzes", { batchId: batchQ, title: "Bad", durationSeconds: 10, questions: [] }, mentor1);
check("duration under 30s -> 400", r.status === 400, r);
r = await call("POST", "/quizzes", { batchId: batchQ, title: "Not mine", durationSeconds: 600 }, om.token);
check("other mentor creating quiz in batch Q -> 404", r.status === 404, r);
r = await call("POST", "/quizzes", { batchId: batchQ, title: "Nope", durationSeconds: 600 }, s1);
check("student creating quiz -> 403", r.status === 403, r);

r = await call("POST", `/quizzes/${quizId}/start`, null, s1);
check("student can't start a draft -> 404", r.status === 404, r);

r = await call("PUT", `/quizzes/${quizId}`, { title: "JavaScript Basics", durationSeconds: 600, questions: [q("Q1", 1, 2), q("Q2", 2, 0, 3), q("Q3", 3, 1, 2)] }, mentor1);
check("replace draft: 3 questions, 6 points", r.status === 200 && r.body.quiz.questions.length === 3 && r.body.quiz.title === "JavaScript Basics", r);
const opts = r.body.quiz.questions[0].options.map(o => o.text);
check("option order preserved", JSON.stringify(opts) === JSON.stringify(["Q1 option 1", "Q1 option 2", "Q1 option 3", "Q1 option 4"]), opts);
const key = r.body.quiz.questions.map(qq => ({ id: qq.id, correct: qq.options.find(o => o.isCorrect).id, wrong: qq.options.find(o => !o.isCorrect).id }));

const empty = (await call("POST", "/quizzes", { batchId: batchQ, title: "Empty", durationSeconds: 60 }, mentor1)).body.quiz;
r = await call("POST", `/quizzes/${empty.id}/publish`, null, mentor1);
check("publishing a quiz with no questions -> 400", r.status === 400, r);

r = await call("POST", `/quizzes/${quizId}/publish`, null, mentor1);
check("publish -> 200", r.status === 200 && r.body.quiz.isPublished, r);
r = await call("PUT", `/quizzes/${quizId}`, { title: "Changed", durationSeconds: 600, questions: [] }, mentor1);
check("edit after publish -> 409", r.status === 409, r);

// ---------- attempts
r = await call("POST", `/quizzes/${quizId}/start`, null, s1);
check("start -> questions, timer from server", r.status === 200 && r.body.questions.length === 3 && new Date(r.body.expiresAt) - new Date(r.body.startedAt) === 600000, r.body);
check("start response has NO correct answers", !JSON.stringify(r.body).includes("isCorrect"), r.body.questions[0]);
const attempt1 = r.body.attemptId;
r = await call("POST", `/quizzes/${quizId}/start`, null, s1);
check("start again resumes same attempt", r.body.attemptId === attempt1, r.body);
r = await call("POST", `/quizzes/${quizId}/start`, null, outsider);
check("student from another batch -> 404", r.status === 404, r);
r = await call("GET", `/quizzes/${quizId}/result`, null, s1);
check("result before submitting -> 409", r.status === 409, r);

r = await call("POST", `/quizzes/${quizId}/submit`, { answers: key.map(k => ({ questionId: k.id, optionId: k.correct })) }, s1);
check("all correct -> 6/6, 100%", r.status === 200 && r.body.score === 6 && r.body.maxScore === 6 && r.body.percentage === 100 && r.body.status === "SUBMITTED", r.body);
check("review now includes correct answers", r.body.review?.every(x => x.correct && x.options.some(o => o.isCorrect)), r.body.review);
r = await call("POST", `/quizzes/${quizId}/submit`, { answers: [] }, s1);
check("submit twice -> 409", r.status === 409, r);
r = await call("POST", `/quizzes/${quizId}/start`, null, s1);
check("start after submitting -> 409", r.status === 409, r);

await call("POST", `/quizzes/${quizId}/start`, null, s2);
r = await call("POST", `/quizzes/${quizId}/submit`, { answers: [{ questionId: "fake", optionId: null }] }, s2);
check("unknown questionId -> 400", r.status === 400, r);
r = await call("POST", `/quizzes/${quizId}/submit`, { answers: [{ questionId: key[0].id, optionId: key[1].correct }] }, s2);
check("option from a different question -> 400", r.status === 400, r);
r = await call("POST", `/quizzes/${quizId}/submit`, { answers: [{ questionId: key[0].id, optionId: key[0].correct }, { questionId: key[1].id, optionId: key[1].wrong }] }, s2);
check("partial: q1 right, q2 wrong, q3 skipped -> 1/6", r.status === 200 && r.body.score === 1 && r.body.review[2].yourOptionId === null && !r.body.review[2].correct, r.body);

// ---------- leaderboard cache
r = await call("GET", `/quizzes/${quizId}/leaderboard`, null, mentor1);
check("leaderboard first read -> MISS", r.status === 200 && r.cache === "MISS", r);
check("leaderboard order: Ava (6) then Ben (1)", r.body.entries.map(e => e.name).join() === "Student ava,Student ben" && r.body.entries[0].rank === 1, r.body.entries);
r = await call("GET", `/quizzes/${quizId}/leaderboard`, null, s2);
check("second read (by a student) -> HIT", r.status === 200 && r.cache === "HIT", r);
check("leaderboard shows no emails", !JSON.stringify(r.body).includes("@"), r.body);
r = await call("GET", `/quizzes/${quizId}/leaderboard`, null, outsider);
check("other batch's student can't see it -> 404", r.status === 404, r);

// Race: double submit
await call("POST", `/quizzes/${quizId}/start`, null, s3);
const body3 = { answers: [{ questionId: key[0].id, optionId: key[0].correct }, { questionId: key[1].id, optionId: key[1].correct }] };
const both = await Promise.all([call("POST", `/quizzes/${quizId}/submit`, body3, s3), call("POST", `/quizzes/${quizId}/submit`, body3, s3)]);
check("double submit at once: one 200, one 409", JSON.stringify(both.map(b => b.status).sort()) === "[200,409]", both.map(b => [b.status, b.body?.error]));
const answersSaved = await db.attemptAnswer.count({ where: { attempt: { quizId, student: { email: `cara.${run}@quiz.test` } } } });
check("...answers saved once (3 rows, not 6)", answersSaved === 3, answersSaved);

r = await call("GET", `/quizzes/${quizId}/leaderboard`, null, mentor1);
check("after new submission -> MISS (cache invalidated)", r.cache === "MISS" && r.body.entries.length === 3, r);
check("new order: Ava 6, Cara 3, Ben 1", r.body.entries.map(e => `${e.name.split(" ")[1]}:${e.score}:${e.rank}`).join() === "ava:6:1,cara:3:2,ben:1:3", r.body.entries);

// Expiry: move s4's start time back past the limit + grace
const st4 = await call("POST", `/quizzes/${quizId}/start`, null, s4);
await db.quizAttempt.update({ where: { id: st4.body.attemptId }, data: { startedAt: new Date(Date.now() - (600 + 20) * 1000) } });
r = await call("POST", `/quizzes/${quizId}/submit`, { answers: key.map(k => ({ questionId: k.id, optionId: k.correct })) }, s4);
check("submit after time + grace -> 409 EXPIRED", r.status === 409 && r.body.details?.status === "EXPIRED", r);
r = await call("GET", `/quizzes/${quizId}/result`, null, s4);
check("expired attempt scores 0", r.body.status === "EXPIRED" && r.body.score === 0, r.body);
r = await call("GET", `/quizzes/${quizId}/leaderboard`, null, mentor1);
check("expired attempt not on leaderboard", r.body.entries.length === 3, r.body.entries);

// Within the grace window still counts
const late = await student("eve", batchQ);
const stLate = await call("POST", `/quizzes/${quizId}/start`, null, late);
await db.quizAttempt.update({ where: { id: stLate.body.attemptId }, data: { startedAt: new Date(Date.now() - (600 + 5) * 1000) } });
r = await call("POST", `/quizzes/${quizId}/submit`, { answers: [{ questionId: key[2].id, optionId: key[2].correct }] }, late);
check("5s late (inside 15s grace) still accepted, time capped at limit", r.status === 200 && r.body.score === 3 && r.body.timeTakenMs === 600000, r.body);

// ---------- batch leaderboard
const quiz2 = (await call("POST", "/quizzes", { batchId: batchQ, title: "Quiz 2", durationSeconds: 120, questions: [q("Only", 1, 0, 2)] }, mentor1)).body.quiz;
await call("POST", `/quizzes/${quiz2.id}/publish`, null, mentor1);
r = await call("GET", `/batches/${batchQ}/leaderboard`, null, s1);
check("batch leaderboard -> MISS", r.status === 200 && r.cache === "MISS", r);
r = await call("GET", `/batches/${batchQ}/leaderboard`, null, mentor1);
check("batch leaderboard again -> HIT", r.cache === "HIT", r);
const k2 = quiz2.questions[0];
await call("POST", `/quizzes/${quiz2.id}/start`, null, s2);
await call("POST", `/quizzes/${quiz2.id}/submit`, { answers: [{ questionId: k2.id, optionId: k2.options.find(o => o.isCorrect).id }] }, s2);
r = await call("GET", `/batches/${batchQ}/leaderboard`, null, mentor1);
check("submission in quiz 2 invalidates batch leaderboard -> MISS", r.cache === "MISS", r);
const ben = r.body.entries.find(e => e.name === "Student ben");
check("Ben: 2 quizzes, 2/7 total", ben?.quizzesTaken === 2 && ben.totalScore === 2 && ben.maxScore === 7, ben);
check("batch ranking: Ava first", r.body.entries[0].name === "Student ava" && r.body.entries[0].rank === 1, r.body.entries);
r = await call("GET", `/batches/${batchQ}/leaderboard`, null, outsider);
check("outsider can't see batch leaderboard -> 404", r.status === 404, r);

// ---------- lists
r = await call("GET", "/quizzes", null, s1);
const mine = r.body.items.find(x => x.id === quizId);
check("student list: published only, with myAttempt", !r.body.items.some(x => x.id === empty.id) && mine?.myAttempt?.score === 6, r.body.items);
r = await call("GET", "/quizzes", null, om.token);
check("other mentor doesn't see batch Q quizzes", !r.body.items.some(x => x.id === quizId), r.body.items.map(x => x.title));
r = await call("GET", `/quizzes/${quizId}/attempts`, null, mentor1);
check("mentor sees all 5 attempts incl. EXPIRED", r.status === 200 && r.body.items.length === 5 && r.body.items.some(a => a.status === "EXPIRED"), r.body.items.map(a => a.status));
r = await call("GET", `/quizzes/${quizId}`, null, s1);
check("student can't open builder view -> 403", r.status === 403, r);
r = await call("DELETE", `/quizzes/${quizId}`, null, mentor1);
check("delete quiz with attempts -> 409", r.status === 409, r);
r = await call("DELETE", `/quizzes/${empty.id}`, null, mentor1);
check("delete empty draft -> 204", r.status === 204, r);

await db.$disconnect();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
