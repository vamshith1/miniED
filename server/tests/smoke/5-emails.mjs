// Phase 6: email queue. Welcome, quiz result and follow-up reminder emails,
// retries, and the admin email log.
import { readFile } from "node:fs/promises";
import { join } from "node:path";

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
  return { status: r.status, body: text ? JSON.parse(text) : null };
}
function check(name, cond, extra) {
  cond ? pass++ : fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  -> " + JSON.stringify(extra).slice(0, 600)}`);
}
const login = async (email, password) => (await call("POST", "/auth/login", { email, password })).body;
const ymd = (o = 0) => { const d = new Date(); d.setDate(d.getDate() + o); return d.toLocaleDateString("en-CA"); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const run = Date.now();
const admin = (await login("admin@miniedcrm.test", "Admin@12345")).token;

// Polls the email log until the newest email to `to` (optionally of one template) leaves QUEUED.
async function waitForEmail(to, template, ms = 15000) {
  const qs = `to=${encodeURIComponent(to)}${template ? `&template=${template}` : ""}`;
  let last;
  for (const end = Date.now() + ms; Date.now() < end; await sleep(250)) {
    last = (await call("GET", `/emails?${qs}`, null, admin)).body.items?.[0];
    if (last && last.status !== "QUEUED") return last;
  }
  return last;
}
// The .eml file, when the API writes emails to server/.outbox (no SMTP_URL).
const health = (await call("GET", "/health")).body;
const outbox = health.mail === "outbox";
const OUTBOX = join(import.meta.dirname, "..", "..", ".outbox");
// Decodes quoted-printable so the body can be searched as plain text.
const readEml = async id =>
  (await readFile(join(OUTBOX, `${id}.eml`), "utf8"))
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

check("health reports queue and mail", ["redis", "postgres"].includes(health.queue) && !!health.mail, health);

// ---------- welcome on signup
const signupEmail = `self.${run}@mail.test`;
let r = await call("POST", "/auth/signup", { name: "Selma Self", email: signupEmail, password: "Selfie@123" });
check("signup -> 201", r.status === 201, r);
let e = await waitForEmail(signupEmail, "welcome");
check("signup: welcome email SENT", e?.status === "SENT" && e.attempts === 1 && e.sentAt, e);
if (outbox) {
  const eml = await readEml(e.id);
  check("welcome .eml: greets by name, no temporary password", eml.includes("Hi Selma Self") && !/temporary password/i.test(eml), eml.slice(0, 300));
}

// ---------- welcome on admin-created user
r = await call("POST", "/users", { name: "Mona Mentor", email: `mona.${run}@mail.test`, password: "Mentor@123", role: "MENTOR" }, admin);
check("admin creates user -> welcomeEmail QUEUED", r.status === 201 && r.body.welcomeEmail?.status === "QUEUED", r.body);
const mona = r.body.user;

// ---------- welcome on conversion, carrying the temporary password
const batchId = (await call("POST", "/batches", { name: `Mail-${run}`, course: "Full Stack Web", startDate: ymd(-7) }, admin)).body.batch.id;
const lead = (await call("POST", "/leads", { name: "Ravi Kumar", email: `ravi.${run}@mail.test` }, admin)).body.lead;
r = await call("POST", `/leads/${lead.id}/convert`, { batchId }, admin);
check("convert -> welcomeEmail QUEUED, no temporaryPassword in response", r.status === 201 && r.body.welcomeEmail?.status === "QUEUED" && !("temporaryPassword" in r.body), r.body);
e = await waitForEmail(lead.email, "welcome");
check("conversion welcome email SENT", e?.status === "SENT", e);
let studentToken;
if (outbox) {
  const eml = await readEml(e.id);
  const pw = eml.match(/temporary password is: (\S+)/)?.[1];
  check("welcome .eml has batch name and temporary password", eml.includes(`Mail-${run}`) && !!pw, eml.slice(0, 400));
  const s = await login(lead.email, pw);
  check("student signs in with the emailed password", !!s.token, s);
  studentToken = s.token;
}
const lead2 = (await call("POST", "/leads", { name: "Asha Rao", email: `asha.${run}@mail.test` }, admin)).body.lead;
r = await call("POST", `/leads/${lead2.id}/convert`, { batchId, password: "Asha@12345" }, admin);
e = await waitForEmail(lead2.email, "welcome");
if (outbox) check("admin-set password: email doesn't include it", e?.status === "SENT" && !(await readEml(e.id)).includes("Asha@12345"), e);
studentToken ??= (await login(lead2.email, "Asha@12345")).token;

// ---------- quiz result
const quiz = (await call("POST", "/quizzes", {
  batchId, title: `Mail quiz ${run}`, durationSeconds: 300,
  questions: [1, 2].map(n => ({ text: `Q${n}`, options: [{ text: "right", isCorrect: true }, { text: "wrong", isCorrect: false }] })),
}, admin)).body.quiz;
await call("POST", `/quizzes/${quiz.id}/publish`, null, admin);
const started = (await call("POST", `/quizzes/${quiz.id}/start`, null, studentToken)).body;
const [q1, q2] = started.questions;
const right = q => q.options.find(o => o.text === "right").id;
r = await call("POST", `/quizzes/${quiz.id}/submit`, { answers: [{ questionId: q1.id, optionId: right(q1) }, { questionId: q2.id, optionId: null }] }, studentToken);
check("submit quiz -> 200, 1/2", r.status === 200 && r.body.score === 1 && r.body.maxScore === 2, r);
const me = (await call("GET", "/auth/me", null, studentToken)).body.user;
e = await waitForEmail(me.email, "quiz-result");
check("quiz-result email SENT", e?.status === "SENT", e);
if (outbox) {
  const eml = await readEml(e.id);
  check("quiz-result .eml: title, score and rank", eml.includes(`Mail quiz ${run}`) && eml.includes("1/2 (50%)") && eml.includes("#1 of 1"), eml.slice(0, 600));
}
r = await call("POST", `/quizzes/${quiz.id}/submit`, { answers: [] }, studentToken);
r = await call("GET", `/emails?to=${encodeURIComponent(me.email)}&template=quiz-result`, null, admin);
check("double submit doesn't send a second result email", r.body.total === 1, r.body);

// ---------- failures are retried, then marked FAILED
r = await call("POST", "/users", { name: "Bounce", email: `bounce.${run}@fail.test`, password: "Bounce@123", role: "MENTOR" }, admin);
if (outbox) {
  // With the default 30 s retry delay this stays QUEUED (retrying) for minutes;
  // start the API with EMAIL_RETRY_DELAY_MS=300 to see it reach FAILED here.
  e = await waitForEmail(`bounce.${run}@fail.test`, "welcome", 8000);
  const errorSaved = /Simulated delivery failure/.test(e?.lastError ?? "");
  if (e?.status === "FAILED") check("failing email retried, then FAILED with the error", e.attempts > 1 && errorSaved, e);
  else check("failing email: error saved, waiting to retry", e?.status === "QUEUED" && e.attempts >= 1 && errorSaved, e);
}

// ---------- daily follow-up reminders
const assignee = mona;
const mk = (name, extra) => call("POST", "/leads", { name, email: `${name.toLowerCase().replace(/\W/g, "")}.${run}@mail.test`, assignedToId: assignee.id, ...extra }, admin).then(x => x.body.lead);
const overdue = await mk("Overdue Olga", { nextFollowUpAt: ymd(-2) });
const today = await mk("Today Tara", { nextFollowUpAt: ymd(0) });
const future = await mk("Future Fiona", { nextFollowUpAt: ymd(3) });
const lost = await mk("Lost Leo", { nextFollowUpAt: ymd(-1) });
await call("PATCH", `/leads/${lost.id}/stage`, { stage: "LOST" }, admin);

r = await call("POST", "/emails/follow-ups/run", null, admin);
const mine = r.body.emails?.find(x => x.to === assignee.email);
check("run follow-ups -> one email for the assignee with 2 leads", r.status === 200 && mine?.leads === 2 && mine.status === "QUEUED", r.body);
e = await waitForEmail(assignee.email, "lead-follow-up");
check("follow-up email SENT", e?.status === "SENT", e);
if (outbox) {
  const eml = await readEml(e.id);
  check("follow-up .eml: overdue + today, not future or lost", eml.includes("Overdue Olga") && eml.includes("Today Tara") && eml.includes("overdue since") && !eml.includes("Future Fiona") && !eml.includes("Lost Leo"), eml.slice(0, 600));
}
r = await call("GET", `/leads/${overdue.id}/timeline`, null, admin);
check("REMINDER_SENT on the lead's timeline", r.body.items.some(a => a.type === "REMINDER_SENT" && a.meta.emailId === e.id), r.body.items);
r = await call("POST", "/emails/follow-ups/run", null, admin);
check("running again the same day skips them", r.status === 200 && !r.body.emails.some(x => x.to === assignee.email) && r.body.skippedAlreadyReminded >= 1, r.body);

// ---------- email log API
r = await call("GET", "/emails?status=SENT&template=welcome&limit=5", null, admin);
check("list emails filtered by status + template", r.status === 200 && r.body.items.every(x => x.status === "SENT" && x.template === "welcome") && r.body.limit === 5, r.body);
r = await call("GET", `/emails/${e.id}`, null, admin);
check("get one email", r.status === 200 && r.body.email.id === e.id, r);
r = await call("GET", "/emails/nope", null, admin);
check("unknown email -> 404", r.status === 404, r);
r = await call("GET", "/emails", null, studentToken);
check("student -> 403", r.status === 403, r);
r = await call("POST", "/emails/follow-ups/run", null, (await login("mentor@miniedcrm.test", "Mentor@12345")).token);
check("mentor can't trigger reminders -> 403", r.status === 403, r);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
