import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { PASSWORD, as, closeApp, createUser, getApp, login, uniqueEmail } from "../helpers.js";

afterAll(closeApp);

describe("health", () => {
  it("reports the database as up", async () => {
    const res = await request(await getApp()).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok", db: "up" });
  });

  it("unknown API routes return a JSON 404", async () => {
    const res = await as(null).get("/nope");
    expect(res.status).toBe(404);
    expect(res.body.error).toEqual(expect.any(String));
  });
});

describe("signup and login", () => {
  it("signup creates a STUDENT, sets the session cookie and queues a welcome email", async () => {
    const email = uniqueEmail("signup");
    const res = await as(null).post("/auth/signup", { name: "New Student", email: email.toUpperCase(), password: PASSWORD });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email, role: "STUDENT" });
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(res.headers["set-cookie"]?.[0]).toMatch(/^mecrm_session=.+HttpOnly/i);
    expect(await prisma.emailLog.count({ where: { to: email, template: "welcome" } })).toBe(1);
  });

  it("signup can't pick a role", async () => {
    const res = await as(null).post("/auth/signup", { name: "Sneaky", email: uniqueEmail("sneaky"), password: PASSWORD, role: "ADMIN" });
    expect(res.status === 400 || res.body.user?.role === "STUDENT").toBe(true);
  });

  it("duplicate email -> 409, bad input -> 400", async () => {
    const email = uniqueEmail("dup");
    await as(null).post("/auth/signup", { name: "First", email, password: PASSWORD });
    expect((await as(null).post("/auth/signup", { name: "Second", email, password: PASSWORD })).status).toBe(409);
    expect((await as(null).post("/auth/signup", { name: "X", email: "not-an-email", password: "short" })).status).toBe(400);
  });

  it("wrong password and unknown email get the same 401", async () => {
    const { user } = await createUser("MENTOR");
    const wrong = await as(null).post("/auth/login", { email: user.email, password: "Wrong@12345" });
    const unknown = await as(null).post("/auth/login", { email: uniqueEmail("ghost"), password: PASSWORD });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error).toBe(unknown.body.error);
  });

  it("a deactivated user can't sign in or use an old token", async () => {
    const admin = await createUser("ADMIN");
    const mentor = await createUser("MENTOR");
    const res = await as(admin.token).patch(`/users/${mentor.user.id}/status`, { isActive: false });
    expect(res.status).toBe(200);
    expect((await as(mentor.token).get("/auth/me")).status).toBe(401);
    // The right password on a deactivated account says so (403); a wrong one is still a plain 401.
    expect((await as(null).post("/auth/login", { email: mentor.user.email, password: PASSWORD })).status).toBe(403);
  });
});

describe("sessions", () => {
  it("/auth/me works with a Bearer token, and 401 without one", async () => {
    const { token, user } = await createUser("MENTOR");
    const me = await as(token).get("/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.user.id).toBe(user.id);
    expect((await as(null).get("/auth/me")).status).toBe(401);
    expect((await as("not.a.token").get("/auth/me")).status).toBe(401);
  });

  it("cookie sessions need the X-Requested-With header for writes (CSRF)", async () => {
    const app = await getApp();
    const agent = request.agent(app);
    const { user } = await createUser("STUDENT");
    expect((await agent.post("/api/auth/login").send({ email: user.email, password: PASSWORD })).status).toBe(200);

    expect((await agent.get("/api/auth/me")).status).toBe(200);
    const blocked = await agent.post("/api/auth/change-password").send({ currentPassword: PASSWORD, newPassword: "Other@12345" });
    expect(blocked.status).toBe(403);
    const allowed = await agent
      .post("/api/auth/change-password")
      .set("X-Requested-With", "miniedcrm")
      .send({ currentPassword: PASSWORD, newPassword: "Other@12345" });
    expect(allowed.status).toBe(200);

    await agent.post("/api/auth/logout").set("X-Requested-With", "miniedcrm");
    expect((await agent.get("/api/auth/me")).status).toBe(401);
  });

  it("changing the password signs out other sessions", async () => {
    const first = await createUser("MENTOR");
    const second = await login(first.user.email, PASSWORD);
    const res = await as(first.token).post("/auth/change-password", { currentPassword: PASSWORD, newPassword: "Changed@12345" });
    expect(res.status).toBe(200);
    expect((await as(second.token).get("/auth/me")).status).toBe(401);
    expect((await as(res.body.token).get("/auth/me")).status).toBe(200);
    expect((await as(null).post("/auth/login", { email: first.user.email, password: "Changed@12345" })).status).toBe(200);
  });

  it("forgot-password answers the same whether or not the account exists", async () => {
    const { user } = await createUser("STUDENT");
    const known = await as(null).post("/auth/forgot-password", { email: user.email });
    const unknown = await as(null).post("/auth/forgot-password", { email: uniqueEmail("nobody") });
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(known.body).toEqual(unknown.body);
    expect(await prisma.passwordResetToken.count({ where: { userId: user.id } })).toBe(1);
  });
});

describe("roles", () => {
  it("only admins can manage users and leads", async () => {
    const mentor = await createUser("MENTOR");
    const student = await createUser("STUDENT");
    for (const who of [mentor, student]) {
      expect((await as(who.token).get("/users")).status).toBe(403);
      expect((await as(who.token).get("/leads")).status).toBe(403);
      expect((await as(who.token).get("/dashboard/stats")).status).toBe(403);
    }
  });

  it("admins create users with any role", async () => {
    const admin = await createUser("ADMIN");
    const email = uniqueEmail("made");
    const res = await as(admin.token).post("/users", { name: "Made Mentor", email, password: PASSWORD, role: "MENTOR" });
    expect(res.status).toBe(201);
    expect((await login(email, PASSWORD)).user.role).toBe("MENTOR");
  });
});
