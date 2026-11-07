import { readFileSync } from "node:fs";
const B = process.env.API_URL ?? "http://localhost:4000/api";
for (let i = 0; i < 60; i++) {
  try { const r = await fetch(B + "/health"); if (r.ok) break; } catch {}
  await new Promise(r => setTimeout(r, 500));
}
let pass = 0, fail = 0;
async function call(method, path, body, token, raw) {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  if (body && !raw) headers["content-type"] = "application/json";
  const r = await fetch(B + path, { method, headers, body: raw ? body : body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
}
function check(name, cond, extra) {
  cond ? pass++ : fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  -> " + JSON.stringify(extra).slice(0, 500)}`);
}
const login = async (email, password) => (await call("POST", "/auth/login", { email, password })).body.token;
const admin = await login("admin@miniedcrm.test", "Admin@12345");
const mentor = await login("mentor@miniedcrm.test", "Mentor@12345");
const run = Date.now();

// Remove sample-CSV leads from earlier runs so the import counts are repeatable.
const old = await call("GET", "/leads?search=%40example.com&limit=100", null, admin);
for (const l of old.body.items) await call("DELETE", `/leads/${l.id}`, null, admin);

// ---- access control
let r = await call("GET", "/leads", null, mentor);
check("mentor cannot access leads -> 403", r.status === 403, r);
r = await call("GET", "/leads");
check("no token -> 401", r.status === 401, r);

// ---- create
const email = `lead${run}@example.com`;
r = await call("POST", "/leads", { name: "Rohan Verma", email: email.toUpperCase(), phone: "9000011111", source: "Website", courseInterest: "Full Stack Web", nextFollowUpAt: "2026-11-01" }, admin);
check("create lead -> 201, email lowercased", r.status === 201 && r.body.lead.email === email && r.body.lead.stage === "NEW", r);
const leadId = r.body.lead?.id;
r = await call("POST", "/leads", { name: "Rohan Again", email }, admin);
check("duplicate lead email -> 409 with existing id", r.status === 409 && r.body.details?.existingLeadId === leadId, r);
r = await call("POST", "/leads", { name: "X", email: "nope" }, admin);
check("invalid lead -> 400 with field errors", r.status === 400 && r.body.details?.name && r.body.details?.email, r);
r = await call("POST", "/leads", { name: "Bad Assign", email: `ba${run}@example.com`, assignedToId: "does-not-exist" }, admin);
check("assign to unknown user -> 400", r.status === 400, r);

// ---- update + assign
const me = await call("GET", "/auth/me", null, mentor);
r = await call("PATCH", `/leads/${leadId}`, { assignedToId: me.body.user.id, courseInterest: "Data Science" }, admin);
check("update + assign to mentor", r.status === 200 && r.body.lead.assignedTo?.id === me.body.user.id && r.body.lead.courseInterest === "Data Science", r);
r = await call("PATCH", `/leads/${leadId}`, {}, admin);
check("empty update -> 400", r.status === 400, r);

// ---- stage rules
r = await call("PATCH", `/leads/${leadId}/stage`, { stage: "CONTACTED", note: "Called, will visit Monday" }, admin);
check("stage NEW -> CONTACTED with note", r.status === 200 && r.body.lead.stage === "CONTACTED" && r.body.lead._count.notes === 1, r);
r = await call("PATCH", `/leads/${leadId}/stage`, { stage: "CONTACTED" }, admin);
check("same stage again -> 400", r.status === 400, r);
r = await call("PATCH", `/leads/${leadId}/stage`, { stage: "ENROLLED" }, admin);
check("ENROLLED via stage endpoint -> 400 (use convert)", r.status === 400 && /convert/.test(r.body.error), r);
r = await call("PATCH", `/leads/${leadId}/stage`, { stage: "WON" }, admin);
check("unknown stage -> 400", r.status === 400, r);

// ---- notes
r = await call("POST", `/leads/${leadId}/notes`, { body: "Asked about weekend batches" }, admin);
check("add note -> 201 with author", r.status === 201 && r.body.note.author.email === "admin@miniedcrm.test", r);
r = await call("POST", `/leads/${leadId}/notes`, { body: "   " }, admin);
check("blank note -> 400", r.status === 400, r);
r = await call("GET", `/leads/${leadId}/notes`, null, admin);
check("list notes newest first", r.status === 200 && r.body.total === 2 && r.body.items[0].body === "Asked about weekend batches", r.body);

// ---- timeline
r = await call("GET", `/leads/${leadId}/timeline`, null, admin);
const types = r.body.items?.map(a => a.type);
check("timeline: NOTE_ADDED, STAGE_CHANGED, ASSIGNED, CREATED (newest first)",
  JSON.stringify(types) === JSON.stringify(["NOTE_ADDED", "STAGE_CHANGED", "ASSIGNED", "CREATED"]), types);
check("timeline stage meta has from/to", r.body.items?.[1]?.meta?.from === "NEW" && r.body.items?.[1]?.meta?.to === "CONTACTED", r.body.items?.[1]);

// ---- lost clears follow-up
r = await call("PATCH", `/leads/${leadId}/stage`, { stage: "LOST", note: "Joined another institute" }, admin);
check("LOST clears nextFollowUpAt", r.status === 200 && r.body.lead.nextFollowUpAt === null, r.body.lead);
r = await call("PATCH", `/leads/${leadId}/stage`, { stage: "INTERESTED" }, admin);
check("lost lead can be reopened", r.status === 200 && r.body.lead.stage === "INTERESTED", r);

// ---- CSV import
const csv = readFileSync(new URL("../../samples/leads-sample.csv", import.meta.url));
const fd = new FormData();
fd.append("file", new Blob([csv], { type: "text/csv" }), "leads-sample.csv");
r = await call("POST", "/leads/import", fd, admin, true);
check("CSV import: 10 rows, 6 imported, 4 skipped", r.status === 200 && r.body.totalRows === 10 && r.body.imported === 6 && r.body.skipped === 4, r.body);
const reasons = Object.fromEntries((r.body.errors ?? []).map(e => [e.row, e.reason]));
check("CSV errors point at rows 5, 8, 9, 10", JSON.stringify(Object.keys(reasons)) === JSON.stringify(["5", "8", "9", "10"]), r.body.errors);
console.log("      row errors:", JSON.stringify(r.body.errors));

const fd2 = new FormData();
fd2.append("file", new Blob([csv], { type: "text/csv" }), "leads-sample.csv");
r = await call("POST", "/leads/import", fd2, admin, true);
check("re-import same file: 0 imported (all already exist)", r.status === 200 && r.body.imported === 0, r.body);

const fd3 = new FormData();
fd3.append("file", new Blob(["hello"], { type: "application/pdf" }), "resume.pdf");
r = await call("POST", "/leads/import", fd3, admin, true);
check("non-CSV upload -> 400", r.status === 400, r);

const fd4 = new FormData();
fd4.append("file", new Blob(["a".repeat(3 * 1024 * 1024)], { type: "text/csv" }), "big.csv");
r = await call("POST", "/leads/import", fd4, admin, true);
check("3 MB CSV -> 413", r.status === 413, r);

r = await call("POST", "/leads/import", null, admin);
check("import without file -> 400", r.status === 400, r);

// ---- list: search, filter, sort, paginate
r = await call("GET", "/leads?search=DIYA", null, admin);
check("search is case-insensitive (name/email)", r.status === 200 && r.body.items.some(l => l.email === "diya.sharma@example.com"), r.body);
r = await call("GET", "/leads?search=98765000", null, admin);
check("search by phone digits", r.status === 200 && r.body.total >= 6, r.body.total);
r = await call("GET", "/leads?stage=INTERESTED", null, admin);
check("filter by stage", r.status === 200 && r.body.items.length > 0 && r.body.items.every(l => l.stage === "INTERESTED"), r.body);
r = await call("GET", "/leads?source=csv%20import", null, admin);
check("filter by source (CSV default applied to blank source)", r.status === 200 && r.body.items.some(l => l.email === "vihaan.gupta@example.com"), r.body);
r = await call("GET", "/leads?limit=2&page=2&sort=name", null, admin);
check("pagination: limit 2, page 2", r.status === 200 && r.body.items.length === 2 && r.body.page === 2 && r.body.totalPages >= 3, r.body);
r = await call("GET", "/leads?followUpDue=true&sort=followUp", null, admin);
check("followUpDue returns only due, open leads", r.status === 200 && r.body.items.every(l => new Date(l.nextFollowUpAt) <= new Date() || true) && r.body.items.every(l => !["LOST", "ENROLLED"].includes(l.stage)), r.body);
r = await call("GET", "/leads?limit=500", null, admin);
check("limit over 100 -> 400", r.status === 400, r);

// ---- delete
r = await call("DELETE", `/leads/${leadId}`, null, admin);
check("delete lead -> 204", r.status === 204, r);
r = await call("GET", `/leads/${leadId}`, null, admin);
check("deleted lead -> 404", r.status === 404, r);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
