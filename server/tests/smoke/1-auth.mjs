const B = process.env.API_URL ?? "http://localhost:4000/api";
for (let i = 0; i < 40; i++) {
  try { await fetch(B + "/health"); break; } catch { await new Promise(r => setTimeout(r, 500)); }
}
let pass = 0, fail = 0;
async function call(method, path, body, token) {
  const r = await fetch(B + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json() };
}
function check(name, cond, extra) {
  cond ? pass++ : fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  -> " + JSON.stringify(extra)}`);
}

let r = await call("GET", "/health");
check("health: db up", r.body.db === "up", r.body);

const email = `student${Date.now()}@miniedcrm.test`;
r = await call("POST", "/auth/signup", { name: "Test Student", email, password: "Student@123", role: "ADMIN" });
check("signup -> 201 with token", r.status === 201 && r.body.token, r);
check("signup ignores role field, is STUDENT", r.body.user?.role === "STUDENT", r.body.user);
check("signup never returns passwordHash", !("passwordHash" in (r.body.user ?? {})), r.body.user);
const studentToken = r.body.token;

r = await call("POST", "/auth/signup", { name: "Dup", email: email.toUpperCase(), password: "Student@123" });
check("duplicate email (case-insensitive) -> 409", r.status === 409, r);

r = await call("POST", "/auth/signup", { name: "X", email: "bad", password: "123" });
check("invalid signup -> 400 with field details", r.status === 400 && r.body.details?.email && r.body.details?.password, r);

r = await call("POST", "/auth/login", { email, password: "wrong-pass" });
check("wrong password -> 401", r.status === 401, r);
r = await call("POST", "/auth/login", { email: "nobody@x.test", password: "whatever1" });
check("unknown email -> same 401 message", r.status === 401 && r.body.error === "Invalid email or password", r);

r = await call("GET", "/auth/me", null, studentToken);
check("me with token -> 200", r.status === 200 && r.body.user.email === email, r);
r = await call("GET", "/auth/me");
check("me without token -> 401", r.status === 401, r);
r = await call("GET", "/auth/me", null, studentToken + "x");
check("me with tampered token -> 401", r.status === 401, r);

r = await call("GET", "/users", null, studentToken);
check("student listing users -> 403", r.status === 403, r);

r = await call("POST", "/auth/login", { email: "mentor@miniedcrm.test", password: "Mentor@12345" });
check("mentor login -> 200", r.status === 200 && r.body.user.role === "MENTOR", r);
r = await call("POST", "/users", { name: "Sneaky", email: "x@x.test", password: "Sneaky@123", role: "ADMIN" }, r.body.token);
check("mentor creating admin -> 403", r.status === 403, r);

r = await call("POST", "/auth/login", { email: "admin@miniedcrm.test", password: "Admin@12345" });
check("admin login -> 200", r.status === 200 && r.body.user.role === "ADMIN", r);
const adminToken = r.body.token;

const mentorEmail = `mentor${Date.now()}@miniedcrm.test`;
r = await call("POST", "/users", { name: "New Mentor", email: mentorEmail, password: "Mentor@999", role: "MENTOR" }, adminToken);
check("admin creates mentor -> 201", r.status === 201 && r.body.user.role === "MENTOR", r);

r = await call("GET", "/users?role=MENTOR&limit=5", null, adminToken);
check("admin lists mentors (paginated)", r.status === 200 && r.body.items.every(u => u.role === "MENTOR") && r.body.total >= 2, r.body);

const me = await call("GET", "/auth/me", null, studentToken);
r = await call("PATCH", `/users/${me.body.user.id}/status`, { isActive: false }, adminToken);
check("admin deactivates student", r.status === 200 && r.body.user.isActive === false, r);
r = await call("GET", "/auth/me", null, studentToken);
check("deactivated student's old token rejected immediately", r.status === 401, r);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
