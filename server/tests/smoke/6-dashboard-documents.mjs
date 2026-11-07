// Phase 7 (API): admin dashboard stats and resume uploads.
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
  return { status: r.status, headers: r.headers, body: text ? JSON.parse(text) : null };
}
function check(name, cond, extra) {
  cond ? pass++ : fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  -> " + JSON.stringify(extra).slice(0, 600)}`);
}
const login = async (email, password) => (await call("POST", "/auth/login", { email, password })).body;
const ymd = (o = 0) => { const d = new Date(); d.setDate(d.getDate() + o); return d.toLocaleDateString("en-CA"); };
const run = Date.now();

async function upload(token, name, bytes, { kind, field = "file" } = {}) {
  const form = new FormData();
  if (bytes) form.append(field, new Blob([bytes]), name);
  if (kind) form.append("kind", kind);
  const r = await fetch(B + "/documents", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form });
  return { status: r.status, body: await r.json() };
}
async function download(token, id) {
  const r = await fetch(`${B}/documents/${id}/download`, { headers: { authorization: `Bearer ${token}` } });
  return { status: r.status, headers: r.headers, bytes: Buffer.from(await r.arrayBuffer()) };
}
const pdf = (text) => Buffer.from(`%PDF-1.4\n% ${text}\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n`);
// Enough of a .docx for the check: a ZIP whose entries include word/document.xml.
const docx = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("....[Content_Types].xml....word/document.xml....")]);

// ---------- setup: two mentors, two batches, students
const admin = (await login("admin@miniedcrm.test", "Admin@12345")).token;
const m1 = await login("mentor@miniedcrm.test", "Mentor@12345");
await call("POST", "/users", { name: "Other Mentor", email: `dm.${run}@mail.test`, password: "Mentor@123", role: "MENTOR" }, admin);
const m2 = await login(`dm.${run}@mail.test`, "Mentor@123");
const batch1 = (await call("POST", "/batches", { name: `Docs-1-${run}`, course: "Full Stack Web", startDate: ymd(-3), mentorId: m1.user.id }, admin)).body.batch.id;
const batch2 = (await call("POST", "/batches", { name: `Docs-2-${run}`, course: "Data Science", startDate: ymd(-3), mentorId: m2.user.id }, admin)).body.batch.id;
async function student(tag, batchId) {
  const lead = (await call("POST", "/leads", { name: `Doc ${tag}`, email: `doc.${tag}.${run}@mail.test` }, admin)).body.lead;
  await call("POST", `/leads/${lead.id}/convert`, { batchId, password: "Student@123" }, admin);
  return login(lead.email, "Student@123");
}
const s1 = await student("one", batch1);
const s2 = await student("two", batch2);

// ---------- dashboard
let r = await call("GET", "/dashboard/stats", null, admin);
const d = r.body;
check("admin dashboard -> 200", r.status === 200 && d.leads && d.attendance && d.quizzes && d.emails, r);
check("byStage adds up to total", Object.values(d.leads.byStage).reduce((a, b) => a + b, 0) === d.leads.total, d.leads);
check("8 weeks of lead trend, oldest first", d.leads.perWeek.length === 8 && d.leads.perWeek[0].weekStart < d.leads.perWeek[7].weekStart, d.leads.perWeek);
check("counts people and batches", d.students >= 2 && d.mentors >= 2 && d.batches.total >= 2 && d.batches.active >= 2, d);
check("conversion rate is a % or null", d.leads.conversionRate === null || (d.leads.conversionRate >= 0 && d.leads.conversionRate <= 100), d.leads);
r = await call("GET", "/dashboard/stats", null, admin);
check("second call served from cache (X-Cache: HIT)", r.headers.get("x-cache") === "HIT" && r.body.generatedAt === d.generatedAt, r.headers.get("x-cache"));
r = await call("GET", "/dashboard/stats", null, m1.token);
check("mentor -> 403", r.status === 403, r);
r = await call("GET", "/dashboard/stats", null, s1.token);
check("student -> 403", r.status === 403, r);

// ---------- uploads: what's accepted
r = await upload(s1.token, "Resume One.pdf", pdf("first"));
check("student uploads PDF resume -> 201", r.status === 201 && r.body.document.kind === "RESUME" && r.body.document.mimeType === "application/pdf" && r.body.replaced === false, r);
const first = r.body.document;
check("response never exposes the stored file name", !("storedName" in first), first);
r = await upload(s1.token, "cv.docx", docx, { kind: "OTHER" });
check("DOCX accepted as OTHER", r.status === 201 && r.body.document.kind === "OTHER" && r.body.document.mimeType.includes("wordprocessingml"), r);
const hindiName = "रिज़्यूमे प्रिया.pdf";
r = await upload(s1.token, hindiName, pdf("second"));
check("new resume replaces the old one", r.status === 201 && r.body.replaced === true, r);
const second = r.body.document;
check("Hindi file name kept", second.originalName === hindiName, second.originalName);

// ---------- uploads: what's rejected
r = await upload(s1.token, "virus.pdf", Buffer.from("MZ\x90\x00 this is an exe"));
check("exe renamed .pdf -> 400", r.status === 400 && /real \.pdf/.test(r.body.error), r);
r = await upload(s1.token, "photo.pdf", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]));
check("PNG renamed .pdf -> 400", r.status === 400, r);
r = await upload(s1.token, "archive.docx", Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("just/some/file.txt")]));
check("plain ZIP renamed .docx -> 400", r.status === 400, r);
r = await upload(s1.token, "notes.txt", Buffer.from("hello"));
check(".txt -> 400", r.status === 400 && /PDF and Word/.test(r.body.error), r);
r = await upload(s1.token, "big.pdf", Buffer.concat([pdf("big"), Buffer.alloc(5 * 1024 * 1024)]));
check("over 5 MB -> 413", r.status === 413, r);
r = await upload(s1.token, "empty.pdf", Buffer.alloc(0));
check("empty file -> 400", r.status === 400, r);
r = await upload(s1.token, null, null);
check("no file -> 400", r.status === 400 && /field named "file"/.test(r.body.error), r);
r = await upload(s1.token, "r.pdf", pdf("x"), { field: "resume" });
check("wrong form field -> 400", r.status === 400, r);
r = await upload(s1.token, "r.pdf", pdf("x"), { kind: "PASSPORT" });
check("unknown kind -> 400", r.status === 400, r);
r = await fetch(B + "/documents", { method: "POST" });
check("not signed in -> 401", r.status === 401, r.status);

// ---------- list and access
r = await call("GET", "/documents", null, s1.token);
check("student lists own: 1 resume + 1 other", r.status === 200 && r.body.items.length === 2 && r.body.items.filter(x => x.kind === "RESUME").length === 1, r.body);
r = await call("GET", `/documents?ownerId=${s1.user.id}`, null, m1.token);
check("their batch mentor can list", r.status === 200 && r.body.items.length === 2, r);
r = await call("GET", `/documents?ownerId=${s1.user.id}`, null, m2.token);
check("another batch's mentor -> 404", r.status === 404, r);
r = await call("GET", `/documents?ownerId=${s1.user.id}`, null, s2.token);
check("another student -> 404", r.status === 404, r);
r = await call("GET", `/documents?ownerId=${s1.user.id}`, null, admin);
check("admin can list anyone's", r.status === 200 && r.body.items.length === 2, r);

// ---------- download
let dl = await download(s1.token, second.id);
check("owner downloads: same bytes", dl.status === 200 && dl.bytes.equals(pdf("second")), dl.status);
check("download headers: type, attachment, UTF-8 name, no-store",
  dl.headers.get("content-type").startsWith("application/pdf") &&
  dl.headers.get("content-disposition").startsWith("attachment;") &&
  dl.headers.get("content-disposition").includes(`filename*=UTF-8''${encodeURIComponent(hindiName)}`) &&
  dl.headers.get("cache-control").includes("no-store") &&
  dl.headers.get("x-content-type-options") === "nosniff",
  Object.fromEntries(dl.headers));
dl = await download(m1.token, second.id);
check("batch mentor downloads -> 200", dl.status === 200, dl.status);
dl = await download(m2.token, second.id);
check("other mentor download -> 404", dl.status === 404, dl.status);
dl = await download(s2.token, second.id);
check("other student download -> 404", dl.status === 404, dl.status);
dl = await download(s1.token, first.id);
check("replaced resume is gone -> 404", dl.status === 404, dl.status);

// ---------- delete
r = await call("DELETE", `/documents/${second.id}`, null, m1.token);
check("mentor can't delete -> 403", r.status === 403, r);
r = await call("DELETE", `/documents/${second.id}`, null, s2.token);
check("other student delete -> 404", r.status === 404, r);
r = await call("DELETE", `/documents/${second.id}`, null, s1.token);
check("owner deletes -> 204", r.status === 204, r);
dl = await download(admin, second.id);
check("deleted file can't be downloaded", dl.status === 404, dl.status);
const other = (await call("GET", "/documents", null, s1.token)).body.items[0];
r = await call("DELETE", `/documents/${other.id}`, null, admin);
check("admin deletes a student's file -> 204", r.status === 204, r);
r = await call("GET", "/documents", null, s1.token);
check("student has no documents left", r.body.items.length === 0, r.body);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
