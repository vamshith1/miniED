import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { signFakeCheckout, signFakeWebhook } from "../../src/modules/payments/gateway.js";
import { render } from "../../src/modules/emails/email.templates.js";
import { hashPassword } from "../../src/lib/password.js";
import { PASSWORD, as, closeApp, createUser, getApp, login, uniqueEmail, ymd } from "../helpers.js";

afterAll(closeApp);

const FEE = 2_000_000; // ₹20,000.00 in paise

let admin: string;
let feeBatchId: string;
let freeBatchId: string;

beforeAll(async () => {
  admin = (await createUser("ADMIN")).token;
  const stamp = Date.now();
  feeBatchId = (await as(admin).post("/batches", { name: `Paid-${stamp}`, course: "Full Stack", startDate: ymd(-1), feePaise: FEE })).body.batch.id;
  freeBatchId = (await as(admin).post("/batches", { name: `Free-${stamp}`, course: "Intro", startDate: ymd(-1) })).body.batch.id;
});

const newLead = async () => (await as(admin).post("/leads", { name: "Paying Lead", email: uniqueEmail("payer") })).body.lead as { id: string; email: string };

async function order(leadId: string, batchId = feeBatchId, extra: object = {}) {
  return as(admin).post("/payments/orders", { leadId, batchId, ...extra });
}

// What the test gateway's checkout hands back after a successful payment.
async function payInCheckout(orderId: string) {
  const res = await as(admin).post("/payments/fake/complete", { orderId, outcome: "success" });
  expect(res.status).toBe(200);
  return res.body as { orderId: string; gatewayPaymentId: string; signature: string };
}

async function webhook(event: object, signature?: string) {
  const raw = JSON.stringify(event);
  return request(await getApp())
    .post("/api/payments/webhook")
    .set("content-type", "application/json")
    .set("x-razorpay-signature", signature ?? signFakeWebhook(raw))
    .send(raw);
}

const capturedEvent = (orderId: string, paymentId: string, amount = FEE) => ({
  event: "payment.captured",
  payload: { payment: { entity: { id: paymentId, order_id: orderId, amount, currency: "INR", status: "captured" } } },
});

const activities = (leadId: string) => prisma.leadActivity.count({ where: { leadId, type: "PAYMENT_RECEIVED" } });

describe("payment setup", () => {
  it("reports the test gateway", async () => {
    const res = await as(admin).get("/payments/config");
    expect(res.body).toMatchObject({ enabled: true, provider: "fake", currency: "INR" });
  });

  it("batch fees are validated", async () => {
    const bad = await as(admin).post("/batches", { name: `Neg-${Date.now()}`, course: "X", startDate: ymd(), feePaise: -1 });
    expect(bad.status).toBe(400);
    const changed = await as(admin).patch(`/batches/${freeBatchId}`, { feePaise: 50_000 });
    expect(changed.body.batch.feePaise).toBe(50_000);
    await as(admin).patch(`/batches/${freeBatchId}`, { feePaise: null });
  });
});

describe("orders", () => {
  it("only admins create orders", async () => {
    const mentor = await createUser("MENTOR");
    const lead = await newLead();
    expect((await as(mentor.token).post("/payments/orders", { leadId: lead.id, batchId: feeBatchId })).status).toBe(403);
  });

  it("takes the amount from the batch, never from the request", async () => {
    const lead = await newLead();
    const res = await order(lead.id, feeBatchId, { amountPaise: 100 });
    expect(res.status).toBe(201);
    expect(res.body.payment).toMatchObject({ amountPaise: FEE, status: "CREATED", provider: "fake" });
    expect(res.body.checkout).toMatchObject({ amountPaise: FEE, currency: "INR", prefill: { email: lead.email } });
    expect(JSON.stringify(res.body)).not.toMatch(/secret/i);
  });

  it("refuses a batch with no fee", async () => {
    const lead = await newLead();
    expect((await order(lead.id, freeBatchId)).status).toBe(400);
  });
});

describe("paying through the checkout", () => {
  it("a forged signature is rejected and nothing is recorded", async () => {
    const lead = await newLead();
    const { checkout } = (await order(lead.id)).body;
    const res = await as(admin).post("/payments/verify", { orderId: checkout.orderId, gatewayPaymentId: "pay_forged", signature: "0".repeat(64) });
    expect(res.status).toBe(400);
    expect((await prisma.payment.findUnique({ where: { gatewayOrderId: checkout.orderId } }))?.status).toBe("CREATED");
  });

  it("a signed result marks it PAID, enrolls the lead and queues a receipt, once", async () => {
    const lead = await newLead();
    const { checkout } = (await order(lead.id)).body;
    const paid = await payInCheckout(checkout.orderId);

    const res = await as(admin).post("/payments/verify", paid);
    expect(res.status).toBe(200);
    expect(res.body.payment).toMatchObject({ status: "PAID", gatewayPaymentId: paid.gatewayPaymentId, enrollmentError: null });
    expect(res.body.enrollment).toMatchObject({ status: "ENROLLED" });
    expect(res.body.enrollment.temporaryPassword).toBeUndefined(); // it goes in the welcome email

    const stored = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(stored.stage).toBe("ENROLLED");
    const student = await prisma.user.findUniqueOrThrow({ where: { email: lead.email } });
    expect(student).toMatchObject({ role: "STUDENT", batchId: feeBatchId });
    expect(await prisma.emailLog.count({ where: { to: lead.email, template: "payment-receipt" } })).toBe(1);

    // The same result again (a retry, a double click): no second enrolment or receipt.
    const again = await as(admin).post("/payments/verify", paid);
    expect(again.status).toBe(200);
    expect(again.body.alreadyProcessed).toBe(true);
    // And the gateway's webhook for the same payment afterwards changes nothing either.
    expect((await webhook(capturedEvent(paid.orderId, paid.gatewayPaymentId))).status).toBe(200);
    expect(await activities(lead.id)).toBe(1);
    expect(await prisma.emailLog.count({ where: { to: lead.email, template: "payment-receipt" } })).toBe(1);

    expect((await as(admin).get(`/payments?leadId=${lead.id}`)).body.items).toHaveLength(1);

    // The receipt shows the amount in rupees and the gateway's payment id.
    const mail = await render("payment-receipt", { paymentId: res.body.payment.id });
    expect(mail.subject).toBe("Payment received: ₹20,000.00 for Full Stack");
    expect(mail.text).toContain(paid.gatewayPaymentId);
  });

  it("a failed attempt can be followed by a successful one on the same order", async () => {
    const lead = await newLead();
    const { checkout } = (await order(lead.id)).body;
    await as(admin).post("/payments/fake/complete", { orderId: checkout.orderId, outcome: "failure" });
    expect((await prisma.payment.findUniqueOrThrow({ where: { gatewayOrderId: checkout.orderId } })).status).toBe("FAILED");

    const paid = await payInCheckout(checkout.orderId);
    expect((await as(admin).post("/payments/verify", paid)).body.payment.status).toBe("PAID");
  });

  it("if enrolment isn't possible, the money is still recorded with the reason", async () => {
    const lead = await newLead();
    await createUser("STUDENT", { email: lead.email }); // this email already has an account
    const { checkout } = (await order(lead.id)).body;
    const res = await as(admin).post("/payments/verify", await payInCheckout(checkout.orderId));
    expect(res.body.payment.status).toBe("PAID");
    expect(res.body.enrollment).toMatchObject({ status: "NOT_ENROLLED", reason: expect.stringMatching(/already exists/) });
    expect(res.body.payment.enrollmentError).toMatch(/already exists/);
  });
});

describe("webhook", () => {
  it("rejects a bad signature", async () => {
    const res = await webhook(capturedEvent("order_x", "pay_x"), "f".repeat(64));
    expect(res.status).toBe(400);
  });

  it("confirms a payment on its own when the browser never came back", async () => {
    const lead = await newLead();
    const { checkout } = (await order(lead.id)).body;
    const paid = await payInCheckout(checkout.orderId); // the browser closed before calling /verify

    const res = await webhook(capturedEvent(paid.orderId, paid.gatewayPaymentId));
    expect(res.status).toBe(200);
    expect(res.body.handled).toBe(true);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).stage).toBe("ENROLLED");

    // A late /verify for the same payment is a no-op.
    expect((await as(admin).post("/payments/verify", paid)).body.alreadyProcessed).toBe(true);
    expect(await activities(lead.id)).toBe(1);
  });

  it("ignores a captured event whose amount doesn't match the order", async () => {
    const lead = await newLead();
    const { checkout } = (await order(lead.id)).body;
    const res = await webhook(capturedEvent(checkout.orderId, "pay_wrong_amount", 100));
    expect(res.body.handled).toBe(false);
    expect((await prisma.payment.findUniqueOrThrow({ where: { gatewayOrderId: checkout.orderId } })).status).toBe("CREATED");
  });

  it("records a failed payment", async () => {
    const lead = await newLead();
    const { checkout } = (await order(lead.id)).body;
    await webhook({ event: "payment.failed", payload: { payment: { entity: { id: "pay_f", order_id: checkout.orderId, error_description: "Card declined" } } } });
    expect(await prisma.payment.findUniqueOrThrow({ where: { gatewayOrderId: checkout.orderId } })).toMatchObject({ status: "FAILED", failureReason: "Card declined" });
  });
});

describe("payment history", () => {
  // A paid-and-enrolled lead, a failed one and a pending one, all with emails unique to this block.
  const tag = `hist${Date.now()}`;
  let paidLead: { id: string; email: string };
  let paidPaymentId: string;

  beforeAll(async () => {
    paidLead = (await as(admin).post("/leads", { name: `History Paid ${tag}`, email: uniqueEmail(tag) })).body.lead;
    const { checkout } = (await order(paidLead.id)).body;
    paidPaymentId = (await as(admin).post("/payments/verify", await payInCheckout(checkout.orderId))).body.payment.id;

    const failedLead = (await as(admin).post("/leads", { name: `History Failed ${tag}`, email: uniqueEmail(tag) })).body.lead;
    const failed = (await order(failedLead.id)).body.checkout;
    await as(admin).post("/payments/fake/complete", { orderId: failed.orderId, outcome: "failure" });

    const pendingLead = (await as(admin).post("/leads", { name: `History Pending ${tag}`, email: uniqueEmail(tag) })).body.lead;
    await order(pendingLead.id);
  });

  it("admins filter by status and search, with totals for the same filters", async () => {
    const all = await as(admin).get(`/payments?search=${tag}`);
    expect(all.status).toBe(200);
    expect(all.body.total).toBe(3);
    expect(all.body.summary).toMatchObject({ paid: 1, failed: 1, pending: 1, collectedPaise: FEE });
    expect(all.body.items[0].lead.name).toMatch(/^History /);

    const paidOnly = await as(admin).get(`/payments?search=${tag}&status=PAID`);
    expect(paidOnly.body.items.map((p: { status: string }) => p.status)).toEqual(["PAID"]);
    expect(paidOnly.body.summary.failed).toBe(1); // totals ignore the status filter

    const future = await as(admin).get(`/payments?search=${tag}&from=${ymd(1)}`);
    expect(future.body.total).toBe(0);
    expect((await as(admin).get(`/payments?search=${tag}&to=${ymd(0)}`)).body.total).toBe(3); // "to" includes today
  });

  it("only admins see everyone's payments", async () => {
    const mentor = await createUser("MENTOR");
    expect((await as(mentor.token).get("/payments")).status).toBe(403);
  });

  it("a student sees only their own payments, without internal details", async () => {
    // Sign in as the student created by the paid enrolment.
    const student = await prisma.user.findUniqueOrThrow({ where: { email: paidLead.email } });
    await prisma.user.update({ where: { id: student.id }, data: { passwordHash: await hashPassword(PASSWORD) } });
    const { token } = await login(paidLead.email, PASSWORD);

    const mine = await as(token).get("/payments/mine");
    expect(mine.status).toBe(200);
    expect(mine.body.items).toHaveLength(1);
    expect(mine.body.items[0]).toMatchObject({ id: paidPaymentId, status: "PAID", amountPaise: FEE, batch: { course: "Full Stack" } });
    expect(mine.body.items[0].createdBy).toBeUndefined();
    expect(mine.body.items[0].enrollmentError).toBeUndefined();
    expect(mine.body.totalPaidPaise).toBe(FEE);

    const other = await createUser("STUDENT");
    expect((await as(other.token).get("/payments/mine")).body.items).toHaveLength(0);
    expect((await as(admin).get("/payments/mine")).status).toBe(403);
  });

  it("the dashboard counts fees collected, refreshed when a payment arrives", async () => {
    const res = await as(admin).get("/dashboard/stats");
    expect(res.body.payments.last30Days.collectedPaise).toBeGreaterThanOrEqual(FEE);
    expect(res.body.payments.last30Days.failed).toBeGreaterThanOrEqual(1);
  });
});

describe("leads with payments", () => {
  it("can't be deleted", async () => {
    const lead = await newLead();
    await order(lead.id);
    expect((await as(admin).delete(`/leads/${lead.id}`)).status).toBe(409);
  });

  it("signature checks use the order and payment ids together", () => {
    expect(signFakeCheckout("order_a", "pay_b")).not.toBe(signFakeCheckout("order_a", "pay_c"));
  });
});
