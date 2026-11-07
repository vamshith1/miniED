// Change password, forgot password and reset links.
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
const sleep = ms => new Promise(r => setTimeout(r, ms));
const run = Date.now();
const admin = (await call("POST", "/auth/login", { email: "admin@miniedcrm.test", password: "Admin@12345" })).body.token;
const outbox = (await call("GET", "/health")).body.mail === "outbox";
const OUTBOX = join(import.meta.dirname, "..", "..", ".outbox");

// Newest email of a type to `to`, once it has left QUEUED.
async function waitForEmail(to, template, after = 0) {
  for (let i = 0; i < 60; i++) {
    const e = (await call("GET", `/emails?to=${encodeURIComponent(to)}&template=${template}`, null, admin)).body.items[0];
    if (e && e.status !== "QUEUED" && new Date(e.createdAt).getTime() >= after) return e;
    await sleep(250);
  }
}
const resetTokenFrom = async id =>
  (await readFile(join(OUTBOX, `${id}.eml`), "utf8")).replace(/=\r?\n/g, "").replace(/=3D/g, "=").match(/reset-password\?token=([A-Za-z0-9_-]+)/)?.[1];

// ---------- change password
const email = `pw.${run}@mail.test`;
let r = await call("POST", "/auth/signup", { name: "Pat Password", email, password: "First@1234" });
const t1 = r.body.token;
const t2 = (await call("POST", "/auth/login", { email, password: "First@1234" })).body.token; // a second device

r = await call("POST", "/auth/change-password", { currentPassword: "nope-nope", newPassword: "Second@1234" }, t1);
check("wrong current password -> 400 with field error", r.status === 400 && r.body.details?.currentPassword, r);
r = await call("POST", "/auth/change-password", { currentPassword: "First@1234", newPassword: "short" }, t1);
check("too-short new password -> 400", r.status === 400 && r.body.details?.newPassword, r);
r = await call("POST", "/auth/change-password", { currentPassword: "First@1234", newPassword: "First@1234" }, t1);
check("same password again -> 400", r.status === 400, r);
r = await call("POST", "/auth/change-password", { currentPassword: "First@1234", newPassword: "Second@1234" });
check("not signed in -> 401", r.status === 401, r);

const changedAt = Date.now() - 1000;
r = await call("POST", "/auth/change-password", { currentPassword: "First@1234", newPassword: "Second@1234" }, t1);
check("change password -> 200 with a new token", r.status === 200 && typeof r.body.token === "string" && r.body.token !== t1, r);
const t3 = r.body.token;
check("the new token works", (await call("GET", "/auth/me", null, t3)).status === 200);
check("this device's old token is signed out", (await call("GET", "/auth/me", null, t1)).status === 401);
r = await call("GET", "/auth/me", null, t2);
check("other device signed out, with a clear message", r.status === 401 && /sign in again/.test(r.body.error), r);
check("old password no longer works", (await call("POST", "/auth/login", { email, password: "First@1234" })).status === 401);
check("new password works", (await call("POST", "/auth/login", { email, password: "Second@1234" })).status === 200);
let e = await waitForEmail(email, "password-changed", changedAt);
check("'password changed' email sent", e?.status === "SENT", e);

// ---------- forgot password
r = await call("POST", "/auth/forgot-password", { email: `nobody.${run}@mail.test` });
const unknownAnswer = r.body;
check("unknown email -> 200 (no hint that it doesn't exist)", r.status === 200, r);
r = await call("GET", `/emails?to=${encodeURIComponent(`nobody.${run}@mail.test`)}`, null, admin);
check("...and no email is queued for it", r.body.total === 0, r.body);
r = await call("POST", "/auth/forgot-password", { email: "not-an-email" });
check("invalid email -> 400", r.status === 400, r);

const askedAt = Date.now() - 1000;
r = await call("POST", "/auth/forgot-password", { email: email.toUpperCase() });
check("known email -> same 200 answer", r.status === 200 && JSON.stringify(r.body) === JSON.stringify(unknownAnswer), r);
e = await waitForEmail(email, "password-reset", askedAt);
check("reset email SENT", e?.status === "SENT", e);
r = await call("POST", "/auth/forgot-password", { email });
await sleep(800);
r = await call("GET", `/emails?to=${encodeURIComponent(email)}&template=password-reset`, null, admin);
check("asking again within a minute doesn't send another", r.body.total === 1, r.body);

if (outbox) {
  const token = await resetTokenFrom(e.id);
  check("reset email contains a link with a token", token?.length >= 40, token);

  r = await call("GET", `/auth/reset-password?token=${token}`);
  check("link check -> 200 with the email", r.status === 200 && r.body.email === email, r);
  r = await call("GET", `/auth/reset-password?token=${"x".repeat(43)}`);
  check("made-up token -> 400", r.status === 400, r);
  r = await call("POST", "/auth/reset-password", { token, newPassword: "short" });
  check("too-short new password -> 400 (link still usable)", r.status === 400, r);

  const tBefore = (await call("POST", "/auth/login", { email, password: "Second@1234" })).body.token;
  const resetAt = Date.now() - 1000;
  r = await call("POST", "/auth/reset-password", { token, newPassword: "Third@12345" });
  check("reset -> 200", r.status === 200, r);
  check("sessions from before the reset are signed out", (await call("GET", "/auth/me", null, tBefore)).status === 401);
  check("new password works", (await call("POST", "/auth/login", { email, password: "Third@12345" })).status === 200);
  check("old password doesn't", (await call("POST", "/auth/login", { email, password: "Second@1234" })).status === 401);
  r = await call("POST", "/auth/reset-password", { token, newPassword: "Fourth@12345" });
  check("same link twice -> 400", r.status === 400, r);
  e = await waitForEmail(email, "password-changed", resetAt);
  check("'password changed' email after a reset", e?.status === "SENT", e);
  const eml = await readFile(join(OUTBOX, `${e.id}.eml`), "utf8");
  check("...saying it was reset, with what to do if it wasn't you", /was reset/.test(eml) && /forgot-password/.test(eml), eml.slice(0, 300));

  // A deactivated account can't use a reset link it already has.
  const other = `pw2.${run}@mail.test`;
  r = await call("POST", "/users", { name: "Second Person", email: other, password: "Other@1234", role: "MENTOR" }, admin);
  const otherId = r.body.user.id;
  await call("POST", "/auth/forgot-password", { email: other });
  const link = await resetTokenFrom((await waitForEmail(other, "password-reset")).id);
  await call("PATCH", `/users/${otherId}/status`, { isActive: false }, admin);
  r = await call("POST", "/auth/reset-password", { token: link, newPassword: "Other@99999" });
  check("deactivated account can't use its reset link", r.status === 400, r);
  r = await call("POST", "/auth/forgot-password", { email: other });
  check("...and asking for a new one sends nothing", r.status === 200 && (await call("GET", `/emails?to=${encodeURIComponent(other)}&template=password-reset`, null, admin)).body.total === 1);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
