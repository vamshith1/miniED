import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, closeApp, createUser, login, uniqueEmail, ymd } from "../helpers.js";

afterAll(closeApp);

let admin: string;
beforeAll(async () => {
  admin = (await createUser("ADMIN")).token;
});

const newLead = async (extra: object = {}) => {
  const res = await as(admin).post("/leads", { name: "Lead Person", email: uniqueEmail("lead"), ...extra });
  expect(res.status).toBe(201);
  return res.body.lead as { id: string; email: string; stage: string };
};

describe("leads", () => {
  it("creates, reads and updates a lead", async () => {
    const lead = await newLead({ source: "WEBSITE", courseInterest: "Data Science" });
    expect(lead.stage).toBe("NEW");
    expect((await as(admin).get(`/leads/${lead.id}`)).body.lead.courseInterest).toBe("Data Science");
    const res = await as(admin).patch(`/leads/${lead.id}`, { phone: "9876543210", nextFollowUpAt: null });
    expect(res.status).toBe(200);
  });

  it("one lead per email, case-insensitive", async () => {
    const lead = await newLead();
    const res = await as(admin).post("/leads", { name: "Again", email: lead.email.toUpperCase() });
    expect(res.status).toBe(409);
    expect(res.body.details?.existingLeadId ?? res.body.existingLeadId).toBe(lead.id);
  });

  it("search finds leads by name", async () => {
    const tag = `Zebra${Date.now()}`;
    await newLead({ name: `${tag} Kapoor` });
    const res = await as(admin).get(`/leads?search=${tag}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.total).toBe(1);
  });

  it("stage changes go on the timeline; ENROLLED needs a conversion", async () => {
    const lead = await newLead();
    expect((await as(admin).patch(`/leads/${lead.id}/stage`, { stage: "CONTACTED", note: "Called" })).status).toBe(200);
    expect((await as(admin).patch(`/leads/${lead.id}/stage`, { stage: "ENROLLED" })).status).toBe(400);
    const timeline = await as(admin).get(`/leads/${lead.id}/timeline`);
    expect(timeline.body.items[0].type).toBe("STAGE_CHANGED");
  });

  it("notes are listed newest first", async () => {
    const lead = await newLead();
    await as(admin).post(`/leads/${lead.id}/notes`, { body: "first" });
    await as(admin).post(`/leads/${lead.id}/notes`, { body: "second" });
    const res = await as(admin).get(`/leads/${lead.id}/notes`);
    expect(res.body.items.map((n: { body: string }) => n.body)).toEqual(["second", "first"]);
  });

  it("CSV import adds valid rows and reports the bad ones", async () => {
    const a = uniqueEmail("csv");
    const b = uniqueEmail("csv");
    const csv = `Name,E-mail,Phone\nAsha,${a},98765\nNo Email,,123\nRavi,${b},\n`;
    const res = await as(admin).upload("/leads/import", Buffer.from(csv), "leads.csv");
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(2);
    expect(res.body.skipped).toBe(1);
    expect(res.body.errors[0].row).toBe(3);
  });

  it("converting a lead creates a student in the batch and locks the lead", async () => {
    const batch = (await as(admin).post("/batches", { name: `Conv-${Date.now()}`, course: "Web", startDate: ymd(-3) })).body.batch;
    const lead = await newLead();
    const res = await as(admin).post(`/leads/${lead.id}/convert`, { batchId: batch.id, password: "Student@123" });
    expect(res.status).toBe(201);
    expect(res.body.student).toMatchObject({ role: "STUDENT", batchId: batch.id, email: lead.email });

    expect((await login(lead.email, "Student@123")).user.role).toBe("STUDENT");
    expect((await as(admin).get(`/leads/${lead.id}`)).body.lead.stage).toBe("ENROLLED");
    expect((await as(admin).post(`/leads/${lead.id}/convert`, { batchId: batch.id })).status).toBe(409);
    expect((await as(admin).delete(`/leads/${lead.id}`)).status).toBe(409);
  });

  it("deletes a lead that isn't enrolled", async () => {
    const lead = await newLead();
    expect([200, 204]).toContain((await as(admin).delete(`/leads/${lead.id}`)).status);
    expect((await as(admin).get(`/leads/${lead.id}`)).status).toBe(404);
  });
});
