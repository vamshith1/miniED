import express, { Router } from "express";
import { z } from "zod";
import { paginationQuery } from "../../lib/pagination.js";
import { dateOnly } from "../../lib/dates.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { limits } from "../../middleware/rate-limit.js";
import { completeFakeCheckout, createOrder, handleWebhook, listPayments, myPayments, paymentConfig, verifyCheckout } from "./payments.service.js";

const id = z.string().trim().min(1).max(100);
const createOrderSchema = z.object({ leadId: id, batchId: id });
const verifySchema = z.object({ orderId: id, gatewayPaymentId: id, signature: z.string().trim().regex(/^[0-9a-f]{64}$/, "Invalid signature") });
const fakeCompleteSchema = z.object({ orderId: id, outcome: z.enum(["success", "failure"]) });
const optionalText = z.string().trim().max(200).optional().transform((v) => v || undefined);
const listSchema = paginationQuery.extend({
  leadId: optionalText,
  status: z.enum(["PAID", "FAILED", "CREATED"]).optional().or(z.literal("").transform(() => undefined)),
  batchId: optionalText,
  search: optionalText,
  from: dateOnly.optional().or(z.literal("").transform(() => undefined)),
  to: dateOnly.optional().or(z.literal("").transform(() => undefined)),
});

export const paymentsRouter = Router();
paymentsRouter.use(requireAuth);

// GET /api/payments/config: whether payments are on, and the public checkout key
paymentsRouter.get("/config", (_req, res) => {
  res.json(paymentConfig());
});

const admin = requireRole("ADMIN");

// POST /api/payments/orders { leadId, batchId }: the amount always comes from the batch fee
paymentsRouter.post("/orders", admin, limits.paymentOrder, async (req, res) => {
  const { leadId, batchId } = createOrderSchema.parse(req.body);
  res.status(201).json(await createOrder(leadId, batchId, req.user!));
});

// POST /api/payments/verify { orderId, gatewayPaymentId, signature }: the checkout's signed result
paymentsRouter.post("/verify", admin, async (req, res) => {
  res.json(await verifyCheckout(verifySchema.parse(req.body)));
});

// POST /api/payments/fake/complete { orderId, outcome }: the test gateway's checkout (404 unless PAYMENT_PROVIDER=fake)
paymentsRouter.post("/fake/complete", admin, async (req, res) => {
  const { orderId, outcome } = fakeCompleteSchema.parse(req.body);
  res.json(await completeFakeCheckout(orderId, outcome));
});

// GET /api/payments?status=&batchId=&search=&from=&to=&leadId=&page=&limit=: every payment, newest first, with totals
paymentsRouter.get("/", admin, async (req, res) => {
  res.json(await listPayments(listSchema.parse(req.query)));
});

// GET /api/payments/mine: the signed-in student's own payments
paymentsRouter.get("/mine", requireRole("STUDENT"), async (req, res) => {
  res.json(await myPayments(req.user!));
});

/**
 * POST /api/payments/webhook: called by the gateway, not by people. No session:
 * it's authenticated by the HMAC signature over the exact bytes received, so it
 * needs the raw body (mounted before express.json in app.ts).
 */
export const paymentsWebhookRouter = Router();
paymentsWebhookRouter.post("/", express.raw({ type: "*/*", limit: "1mb" }), async (req, res) => {
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const result = await handleWebhook(raw, req.header("x-razorpay-signature"));
  res.json({ ok: true, ...result });
});
