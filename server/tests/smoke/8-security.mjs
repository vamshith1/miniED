// Session cookies, CSRF protection and rate limits.
// The rate-limit checks need limits on for local requests: start the API with
// RATE_LIMIT_LOCAL=true (otherwise they're skipped, and the suite says so).
const B = process.env.API_URL ?? "http://localhost:4000/api";
for (let i = 0; i < 60; i++) {
  try { const r = await fetch(B + "/health"); if (r.ok) break; } catch {}
  await new Promise(r => setTimeout(r, 500));
}
let pass = 0, fail = 0;
function check(name, cond, extra) {
  cond ? pass++ : fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  -> " + JSON.stringify(extra).slice(0, 600)}`);
}
// Low-level request: `cookie` and `csrf` let each check control exactly what's sent.
async function req(method, path, { body, cookie, csrf, bearer } = {}) {
  const headers = {};
  if (body) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  if (csrf) headers["x-requested-with"] = "miniedcrm";
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  const r = await fetch(B + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  return { status: r.status, headers: r.headers, body: text ? JSON.parse(text) : null };
}
const sessionCookie = (r) => {
  const raw = r.headers.get("set-cookie") ?? "";
  return { raw, pair: raw.match(/mecrm_session=[^;]*/)?.[0] ?? null };
};
const run = Date.now();
const health = (await req("GET", "/health")).body;

// ---------- the session cookie
let r = await req("POST", "/auth/login", { body: { email: "admin@miniedcrm.test", password: "Admin@12345" } });
let c = sessionCookie(r);
check("login sets the session cookie", r.status === 200 && !!c.pair, c.raw);
check("cookie is HttpOnly, SameSite=Lax, limited to /api", /HttpOnly/i.test(c.raw) && /SameSite=Lax/i.test(c.raw) && /Path=\/api/i.test(c.raw) && /Max-Age=\d+/i.test(c.raw), c.raw);
const adminCookie = c.pair;

r = await req("GET", "/auth/me", { cookie: adminCookie });
check("cookie alone signs you in", r.status === 200 && r.body.user.role === "ADMIN", r);
r = await req("GET", "/auth/me");
check("no cookie, no token -> 401", r.status === 401, r);
r = await req("GET", "/auth/me", { cookie: "mecrm_session=garbage" });
check("forged cookie -> 401", r.status === 401, r);

// ---------- CSRF: cookie-authenticated writes need the X-Requested-With header
const lead = { name: "Csrf Check", email: `csrf.${run}@mail.test` };
r = await req("POST", "/leads", { body: lead, cookie: adminCookie });
check("write with cookie but no header -> 403", r.status === 403 && /X-Requested-With/.test(r.body.error), r);
r = await req("GET", `/leads?search=csrf.${run}`, { cookie: adminCookie });
check("...and nothing was created", r.body.total === 0, r.body);
r = await req("POST", "/leads", { body: lead, cookie: adminCookie, csrf: true });
check("write with cookie + header -> 201", r.status === 201, r);
const bearer = (await req("POST", "/auth/login", { body: { email: "admin@miniedcrm.test", password: "Admin@12345" } })).body.token;
r = await req("DELETE", `/leads/${r.body.lead.id}`, { bearer });
check("Bearer token writes don't need the header", r.status === 204, r);

// ---------- logout and password change
const email = `sec.${run}@mail.test`;
r = await req("POST", "/auth/signup", { body: { name: "Sam Secure", email, password: "Secure@1234" } });
let mine = sessionCookie(r).pair;
check("signup also sets the cookie", !!mine, r.headers.get("set-cookie"));
r = await req("POST", "/auth/change-password", { body: { currentPassword: "Secure@1234", newPassword: "Secure@5678" }, cookie: mine, csrf: true });
const fresh = sessionCookie(r).pair;
check("change password sets a fresh cookie", r.status === 200 && !!fresh && fresh !== mine, r);
check("the old cookie no longer works", (await req("GET", "/auth/me", { cookie: mine })).status === 401);
check("the fresh one does", (await req("GET", "/auth/me", { cookie: fresh })).status === 200);
r = await req("POST", "/auth/logout", { cookie: fresh, csrf: true });
const cleared = r.headers.get("set-cookie") ?? "";
check("logout clears the cookie", r.status === 204 && /mecrm_session=;/.test(cleared) && /Expires=Thu, 01 Jan 1970/i.test(cleared), cleared);

// ---------- rate limits
if (health.rateLimits !== "on") {
  console.log("SKIP  rate limits are off for local requests (start the API with RATE_LIMIT_LOCAL=true to test them)");
} else {
  // Health is never limited, so uptime checks can't lock the site out.
  const healthCodes = await Promise.all(Array.from({ length: 30 }, () => req("GET", "/health").then((x) => x.status)));
  check("health check isn't rate limited", healthCodes.every((s) => s === 200), healthCodes);

  // Forgot password: hammer it until the limit kicks in.
  let first, blocked;
  for (let i = 0; i < 40 && !blocked; i++) {
    const x = await req("POST", "/auth/forgot-password", { body: { email: `nobody.${run}@mail.test` } });
    if (i === 0) first = x;
    if (x.status === 429) blocked = x;
  }
  const limit = Number(first.headers.get("ratelimit-limit"));
  check("responses carry RateLimit-Limit / Remaining headers", limit > 0 && first.headers.get("ratelimit-remaining") !== null, Object.fromEntries(first.headers));
  check("forgot-password blocked with 429 after the limit", !!blocked && /Too many/.test(blocked.body.error), blocked?.body);
  check("429 says when to retry (Retry-After)", Number(blocked?.headers.get("retry-after")) > 0, blocked && Object.fromEntries(blocked.headers));

  // Login: 10 attempts per email per 15 minutes, then blocked even with the right password.
  const victim = `brute.${run}@mail.test`;
  await req("POST", "/auth/signup", { body: { name: "Bruce Force", email: victim, password: "Correct@1234" } });
  const codes = [];
  for (let i = 0; i < 10; i++) codes.push((await req("POST", "/auth/login", { body: { email: victim, password: `guess-${i}-xx` } })).status);
  check("10 wrong passwords -> 401 each", codes.every((s) => s === 401), codes);
  const t0 = Date.now();
  r = await req("POST", "/auth/login", { body: { email: victim, password: "Correct@1234" } });
  check("11th try is blocked, even with the right password", r.status === 429 && /sign-in attempts/.test(r.body.error), r);
  check("...and answered without checking the password (fast)", Date.now() - t0 < 300, Date.now() - t0);
  r = await req("POST", "/auth/login", { body: { email: "admin@miniedcrm.test", password: "Admin@12345" } });
  check("other accounts from the same IP can still sign in", r.status === 200, r);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
