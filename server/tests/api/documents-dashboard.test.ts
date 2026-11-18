import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, closeApp, createUser, ymd } from "../helpers.js";

afterAll(closeApp);

const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const exe = Buffer.from("MZ\x90\x00\x03\x00\x00\x00 not a pdf", "binary");

type Session = Awaited<ReturnType<typeof createUser>>;
let admin: Session, mentor: Session, otherMentor: Session, student: Session, classmate: Session;

beforeAll(async () => {
  admin = await createUser("ADMIN");
  mentor = await createUser("MENTOR");
  otherMentor = await createUser("MENTOR");
  const batch = (await as(admin.token).post("/batches", { name: `Docs-${Date.now()}`, course: "Web", startDate: ymd(-5), mentorId: mentor.user.id }))
    .body.batch;
  student = await createUser("STUDENT", { batchId: batch.id });
  classmate = await createUser("STUDENT", { batchId: batch.id });
});

describe("documents", () => {
  let docId: string;

  it("accepts a real PDF resume, and a new one replaces it", async () => {
    const first = await as(student.token).upload("/documents", pdf, "resume.pdf");
    expect(first.status).toBe(201);
    expect(first.body.document).toMatchObject({ kind: "RESUME", mimeType: "application/pdf" });
    expect(first.body.document.storedName).toBeUndefined();
    const second = await as(student.token).upload("/documents", pdf, "resume-v2.pdf");
    expect(second.body.replaced).toBe(true);
    docId = second.body.document.id;
  });

  it("rejects files whose bytes don't match the extension", async () => {
    const res = await as(student.token).upload("/documents", exe, "virus.pdf");
    expect(res.status).toBe(400);
    expect((await as(student.token).upload("/documents", Buffer.from("hello"), "notes.txt")).status).toBe(400);
    expect((await as(null).upload("/documents", pdf, "resume.pdf")).status).toBe(401);
  });

  it("owner, admin and the batch mentor can download; others get 404", async () => {
    const own = await as(student.token).get(`/documents/${docId}/download`);
    expect(own.status).toBe(200);
    expect(own.headers["content-disposition"]).toMatch(/^attachment/);
    expect(own.headers["cache-control"]).toContain("no-store");
    expect((await as(admin.token).get(`/documents/${docId}/download`)).status).toBe(200);
    expect((await as(mentor.token).get(`/documents/${docId}/download`)).status).toBe(200);
    expect((await as(otherMentor.token).get(`/documents/${docId}/download`)).status).toBe(404);
    expect((await as(classmate.token).get(`/documents/${docId}/download`)).status).toBe(404);
  });

  it("only the owner or an admin can delete", async () => {
    expect((await as(mentor.token).delete(`/documents/${docId}`)).status).toBe(403); // the mentor may view, not delete
    expect((await as(otherMentor.token).delete(`/documents/${docId}`)).status).toBe(404);
    expect([200, 204]).toContain((await as(student.token).delete(`/documents/${docId}`)).status);
    expect((await as(student.token).get("/documents")).body.items).toHaveLength(0);
  });
});

describe("dashboard", () => {
  it("admins get stats, cached for the next call", async () => {
    const first = await as(admin.token).get("/dashboard/stats");
    expect(first.status).toBe(200);
    expect(first.body).toHaveProperty("leads.byStage");
    expect(first.body.leads.perWeek).toHaveLength(8);
    const second = await as(admin.token).get("/dashboard/stats");
    expect(second.headers["x-cache"]).toBe("HIT");
  });
});

describe("cron endpoint", () => {
  it("needs the secret", async () => {
    expect((await as(null).post("/cron/follow-ups")).status).toBe(401);
  });
});
