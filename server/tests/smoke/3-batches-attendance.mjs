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
const ymd = (offsetDays = 0) => { const d = new Date(); d.setDate(d.getDate() + offsetDays); return d.toLocaleDateString("en-CA"); };
const run = Date.now();

// The generated password arrives by email (Phase 6). Read it from the .eml file
// the API writes to server/.outbox when SMTP_URL isn't set.
async function emailedPassword(to) {
  for (let i = 0; i < 60; i++) {
    const e = (await call("GET", `/emails?to=${encodeURIComponent(to)}&template=welcome`, null, admin)).body.items[0];
    if (e?.status === "SENT") {
      const eml = (await readFile(join(import.meta.dirname, "..", "..", ".outbox", `${e.id}.eml`), "utf8")).replace(/=\r?\n/g, "");
      return eml.match(/temporary password is: (\S+)/)?.[1];
    }
    await new Promise(r => setTimeout(r, 250));
  }
}

const admin = (await login("admin@miniedcrm.test", "Admin@12345")).token;
const m1 = await login("mentor@miniedcrm.test", "Mentor@12345");
const mentor1 = m1.token;
let r = await call("POST", "/users", { name: "Second Mentor", email: `m2.${run}@miniedcrm.test`, password: "Mentor2@123", role: "MENTOR" }, admin);
const mentor2Id = r.body.user.id;
const mentor2 = (await login(`m2.${run}@miniedcrm.test`, "Mentor2@123")).token;

// ---------- batches
r = await call("POST", "/batches", { name: `FS-A-${run}`, course: "Full Stack Web", startDate: ymd(-30), mentorId: m1.user.id }, admin);
check("admin creates batch A", r.status === 201 && r.body.batch.mentor.id === m1.user.id && r.body.batch.startDate.startsWith(ymd(-30)), r);
const batchA = r.body.batch?.id;
r = await call("POST", "/batches", { name: `DS-B-${run}`, course: "Data Science", startDate: ymd(-10), mentorId: mentor2Id }, admin);
const batchB = r.body.batch?.id;
check("admin creates batch B", r.status === 201, r);
r = await call("POST", "/batches", { name: `FS-A-${run}`, course: "Another course", startDate: ymd(-1) }, admin);
check("duplicate batch name -> 409", r.status === 409, r);
r = await call("POST", "/batches", { name: `Bad-${run}`, course: "X", startDate: ymd(0), endDate: ymd(-5) }, admin);
check("endDate before startDate -> 400", r.status === 400, r);
r = await call("POST", "/batches", { name: `Bad2-${run}`, course: "X", startDate: "07/11/2026" }, admin);
check("bad date format -> 400", r.status === 400, r);
r = await call("POST", "/batches", { name: `Bad3-${run}`, course: "X", startDate: ymd(0), mentorId: (await call("GET", "/auth/me", null, admin)).body.user.id }, admin);
check("admin as mentorId -> 400 (must be mentor)", r.status === 400, r);
r = await call("POST", "/batches", { name: `Nope-${run}`, course: "X", startDate: ymd(0) }, mentor1);
check("mentor creating batch -> 403", r.status === 403, r);

// ---------- conversion
async function newLead(tag, extra = {}) {
  const res = await call("POST", "/leads", { name: `Lead ${tag}`, email: `${tag}.${run}@example.org`, phone: "9111100000", nextFollowUpAt: ymd(1), ...extra }, admin);
  return res.body.lead;
}
const l1 = await newLead("stu1");
r = await call("POST", `/leads/${l1.id}/convert`, { batchId: batchA }, admin);
check("convert lead -> 201, student in batch A", r.status === 201 && r.body.student.role === "STUDENT" && r.body.student.batchId === batchA && r.body.student.email === l1.email, r);
check("generated password goes in the welcome email, not the response", r.body.welcomeEmail?.status === "QUEUED" && !("temporaryPassword" in r.body), r.body);
const stu1Pass = await emailedPassword(l1.email);
check("temporary password read from the welcome email", typeof stu1Pass === "string" && stu1Pass.length >= 12, stu1Pass);
const stu1Id = r.body.student?.id;
r = await call("GET", `/leads/${l1.id}`, null, admin);
check("lead now ENROLLED, linked, follow-up cleared", r.body.lead.stage === "ENROLLED" && r.body.lead.convertedUserId === stu1Id && r.body.lead.nextFollowUpAt === null, r.body.lead);
r = await call("GET", `/leads/${l1.id}/timeline`, null, admin);
check("timeline has CONVERTED with batch name", r.body.items[0].type === "CONVERTED" && r.body.items[0].meta.batchName === `FS-A-${run}`, r.body.items[0]);
r = await call("POST", `/leads/${l1.id}/convert`, { batchId: batchA }, admin);
check("convert twice -> 409", r.status === 409, r);
r = await call("PATCH", `/leads/${l1.id}/stage`, { stage: "LOST" }, admin);
check("enrolled lead stage locked -> 409", r.status === 409, r);
r = await call("DELETE", `/leads/${l1.id}`, null, admin);
check("enrolled lead can't be deleted -> 409", r.status === 409, r);
const stu1 = await login(l1.email, stu1Pass);
check("student logs in with temporary password", stu1?.user?.role === "STUDENT" && stu1.user.batchId === batchA, stu1);

const l2 = await newLead("stu2");
r = await call("POST", `/leads/${l2.id}/convert`, { batchId: batchA, password: "MyOwnPass@1" }, admin);
check("convert with admin-set password: no temporaryPassword", r.status === 201 && !("temporaryPassword" in r.body), r.body);
const stu2Id = r.body.student.id;
const stu2 = await login(l2.email, "MyOwnPass@1");

const l3 = await newLead("stu3");
r = await call("POST", `/leads/${l3.id}/convert`, { batchId: "nope" }, admin);
check("convert into unknown batch -> 400", r.status === 400, r);
r = await call("POST", `/leads/${l3.id}/convert`, { batchId: batchA }, admin);
const stu3Id = r.body.student.id;

// Rollback: email already used by a user account
const clashEmail = `clash.${run}@example.org`;
await call("POST", "/auth/signup", { name: "Already Signed Up", email: clashEmail, password: "Signup@123" });
const lc = await newLead("clash-lead", { email: clashEmail });
r = await call("POST", `/leads/${lc.id}/convert`, { batchId: batchA }, admin);
check("convert when email already has an account -> 409", r.status === 409, r);
r = await call("GET", `/leads/${lc.id}`, null, admin);
check("...and the lead was rolled back (not ENROLLED)", r.body.lead.stage === "NEW" && r.body.lead.convertedUserId === null, r.body.lead);

// Race: two admins convert the same lead at the same moment
const lr = await newLead("race");
const both = await Promise.all([
  call("POST", `/leads/${lr.id}/convert`, { batchId: batchB }, admin),
  call("POST", `/leads/${lr.id}/convert`, { batchId: batchB }, admin),
]);
const codes = both.map(x => x.status).sort();
check("concurrent converts: exactly one 201 and one 409", JSON.stringify(codes) === "[201,409]", both);
const raceUsers = await call("GET", `/users?role=STUDENT&limit=100`, null, admin);
check("...and only one student account was created", raceUsers.body.items.filter(u => u.email === lr.email).length === 1, null);

// ---------- batch visibility
r = await call("GET", "/batches", null, mentor1);
check("mentor1 sees only their batches", r.body.items.some(b => b.id === batchA) && !r.body.items.some(b => b.id === batchB), r.body.items.map(b => b.name));
r = await call("GET", "/batches", null, stu1.token);
check("student sees only their batch", r.body.items.length === 1 && r.body.items[0].id === batchA, r.body);
r = await call("GET", `/batches/${batchB}`, null, stu1.token);
check("student opening another batch -> 404", r.status === 404, r);
r = await call("GET", `/batches/${batchB}`, null, mentor1);
check("mentor opening another mentor's batch -> 404", r.status === 404, r);
r = await call("GET", `/batches/${batchA}/students`, null, mentor1);
check("mentor sees roster of own batch", r.status === 200 && r.body.items.length === 3, r.body);
r = await call("GET", `/batches/${batchA}/students`, null, stu1.token);
check("student can't see roster -> 403", r.status === 403, r);
r = await call("GET", `/batches/${batchA}`, null, admin);
check("batch shows student count", r.body.batch._count.students === 3, r.body.batch);

// ---------- attendance
const today = ymd(0), yesterday = ymd(-1);
r = await call("PUT", `/batches/${batchA}/attendance`, { date: today, records: [{ studentId: stu1Id, status: "PRESENT" }, { studentId: stu2Id, status: "PRESENT" }] }, mentor1);
check("mentor marks today", r.status === 200 && r.body.marked === 2, r);
r = await call("PUT", `/batches/${batchA}/attendance`, { date: today, records: [{ studentId: stu1Id, status: "LATE" }] }, mentor1);
check("re-marking same day updates (upsert)", r.status === 200, r);
await call("PUT", `/batches/${batchA}/attendance`, { date: yesterday, records: [{ studentId: stu1Id, status: "ABSENT" }, { studentId: stu2Id, status: "PRESENT" }] }, admin);

r = await call("PUT", `/batches/${batchA}/attendance`, { date: ymd(1), records: [{ studentId: stu1Id, status: "PRESENT" }] }, mentor1);
check("future date -> 400", r.status === 400, r);
r = await call("PUT", `/batches/${batchA}/attendance`, { date: ymd(-60), records: [{ studentId: stu1Id, status: "PRESENT" }] }, mentor1);
check("before batch start -> 400", r.status === 400, r);
r = await call("PUT", `/batches/${batchA}/attendance`, { date: today, records: [{ studentId: stu1Id, status: "PRESENT" }, { studentId: m1.user.id, status: "PRESENT" }] }, mentor1);
check("student not in batch -> 400 listing them", r.status === 400 && r.body.details?.notInBatch?.[0] === m1.user.id, r);
r = await call("PUT", `/batches/${batchA}/attendance`, { date: today, records: [{ studentId: stu1Id, status: "PRESENT" }, { studentId: stu1Id, status: "ABSENT" }] }, mentor1);
check("same student twice -> 400", r.status === 400, r);
r = await call("PUT", `/batches/${batchA}/attendance`, { date: today, records: [{ studentId: stu1Id, status: "PRESENT" }] }, mentor2);
check("other mentor marking batch A -> 404", r.status === 404, r);
r = await call("PUT", `/batches/${batchA}/attendance`, { date: today, records: [{ studentId: stu1Id, status: "PRESENT" }] }, stu1.token);
check("student marking attendance -> 403", r.status === 403, r);

r = await call("GET", `/batches/${batchA}/attendance?date=${today}`, null, mentor1);
const st = Object.fromEntries(r.body.items.map(i => [i.student.id, i.status]));
check("day roster: stu1 LATE, stu2 PRESENT, stu3 unmarked", st[stu1Id] === "LATE" && st[stu2Id] === "PRESENT" && st[stu3Id] === null && r.body.unmarked === 1, r.body);

r = await call("GET", `/batches/${batchA}/attendance/summary`, null, mentor1);
const sm = Object.fromEntries(r.body.items.map(i => [i.student.id, i]));
check("summary: stu1 50% (late counts, 1 absent)", sm[stu1Id].percentage === 50 && sm[stu1Id].late === 1 && sm[stu1Id].absent === 1, sm[stu1Id]);
check("summary: stu2 100%", sm[stu2Id].percentage === 100 && sm[stu2Id].total === 2, sm[stu2Id]);
check("summary: stu3 null (nothing marked)", sm[stu3Id].percentage === null && sm[stu3Id].total === 0, sm[stu3Id]);
check("batch average 75% (ignores unmarked student)", r.body.averagePercentage === 75, r.body.averagePercentage);

r = await call("GET", "/attendance/me", null, stu1.token);
check("student sees own attendance: 2 days, 50%", r.status === 200 && r.body.total === 2 && r.body.percentage === 50 && r.body.recent[0].date === today, r.body);
r = await call("GET", "/attendance/me", null, stu2.token);
check("second student sees 100%", r.body.percentage === 100, r.body);
r = await call("GET", "/attendance/me", null, admin);
check("admin on /attendance/me -> 403", r.status === 403, r);

// ---------- move / remove students
r = await call("DELETE", `/batches/${batchA}/students/${stu3Id}`, null, admin);
check("admin removes student from batch -> 204", r.status === 204, r);
r = await call("DELETE", `/batches/${batchA}/students/${stu3Id}`, null, admin);
check("removing again -> 404", r.status === 404, r);
r = await call("POST", `/batches/${batchB}/students`, { studentId: stu3Id }, admin);
check("admin adds student to batch B", r.status === 200 && r.body.student.batchId === batchB, r);
r = await call("POST", `/batches/${batchB}/students`, { studentId: m1.user.id }, admin);
check("adding a mentor as a student -> 400", r.status === 400, r);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
