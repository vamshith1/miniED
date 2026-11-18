import { randomBytes } from "node:crypto";
import { Prisma, type Payment } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { cacheKeys, invalidate } from "../../lib/cache.js";
import { paginated, toSkipTake } from "../../lib/pagination.js";
import { toDbDate } from "../../lib/dates.js";
import { HttpError } from "../../lib/http-error.js";
import type { AuthUser } from "../../middleware/auth.js";
import { enqueueEmail } from "../emails/email.queue.js";
import { convertLead } from "../leads/leads.convert.js";
import { fakeId, getGateway, requireGateway, signFakeCheckout } from "./gateway.js";

/**
 * Course-fee payments. The flow:
 *   1. createOrder: the server reads the fee from the batch (the browser never sends
 *      an amount), creates an order at the gateway and a CREATED Payment row.
 *   2. The payer pays in the gateway's checkout. The browser gets back a payment id
 *      and a signature.
 *   3. verifyCheckout: the server checks that signature, then confirmPaid.
 *   4. The gateway's webhook reports the same payment again, directly to the server
 *      (in case the browser closed). handleWebhook checks its signature, then confirmPaid.
 * confirmPaid is idempotent: whichever of 3 and 4 arrives first marks the payment PAID,
 * records it on the lead's timeline, queues the receipt and enrolls the lead. The other
 * one finds it already done.
 */

const CURRENCY = "INR";

const paymentSelect = {
  id: true,
  amountPaise: true,
  currency: true,
  status: true,
  provider: true,
  gatewayOrderId: true,
  gatewayPaymentId: true,
  failureReason: true,
  enrollmentError: true,
  createdAt: true,
  paidAt: true,
  leadId: true,
  lead: { select: { id: true, name: true, email: true, stage: true } },
  batch: { select: { id: true, name: true, course: true } },
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.PaymentSelect;

export function paymentConfig() {
  const g = getGateway();
  return { enabled: !!g, provider: g?.name ?? null, keyId: g?.keyId ?? null, currency: CURRENCY };
}

export async function createOrder(leadId: string, batchId: string, actor: AuthUser) {
  const gateway = requireGateway();
  const [lead, batch] = await Promise.all([
    prisma.lead.findUnique({ where: { id: leadId }, select: { id: true, name: true, email: true, phone: true, stage: true } }),
    prisma.batch.findUnique({ where: { id: batchId }, select: { id: true, name: true, course: true, feePaise: true } }),
  ]);
  if (!lead) throw new HttpError(404, "Lead not found");
  if (!batch) throw new HttpError(400, "batchId does not match any batch");
  if (lead.stage === "ENROLLED") throw new HttpError(409, "This lead is already enrolled");
  if (!batch.feePaise) throw new HttpError(400, "This batch has no fee set. Set one on the batch, or enroll without payment.");

  const receipt = `rcpt_${randomBytes(9).toString("hex")}`; // Razorpay allows up to 40 characters
  const { orderId } = await gateway.createOrder({
    amountPaise: batch.feePaise,
    currency: CURRENCY,
    receipt,
    notes: { leadId: lead.id, batchId: batch.id },
  });
  const payment = await prisma.payment.create({
    data: {
      amountPaise: batch.feePaise,
      currency: CURRENCY,
      provider: gateway.name,
      gatewayOrderId: orderId,
      leadId: lead.id,
      batchId: batch.id,
      createdById: actor.id,
    },
    select: paymentSelect,
  });

  return {
    payment,
    // Everything the browser checkout needs. Only public values: never a secret.
    checkout: {
      provider: gateway.name,
      keyId: gateway.keyId,
      orderId,
      amountPaise: batch.feePaise,
      currency: CURRENCY,
      description: `${batch.course} · ${batch.name}`,
      prefill: { name: lead.name, email: lead.email, contact: lead.phone ?? undefined },
    },
  };
}

type Enrollment =
  | { status: "ENROLLED"; studentId: string; welcomeEmail: { id: string; status: string }; temporaryPassword?: string }
  | { status: "NOT_ENROLLED"; reason: string };

async function enrollAfterPayment(payment: Payment): Promise<Enrollment> {
  try {
    const result = await convertLead(payment.leadId, payment.batchId, payment.createdById);
    return {
      status: "ENROLLED",
      studentId: result.student.id,
      welcomeEmail: result.welcomeEmail,
      ...(result.temporaryPassword ? { temporaryPassword: result.temporaryPassword } : {}),
    };
  } catch (err) {
    // The money is recorded either way; the admin sees why enrolment didn't happen and can fix it.
    const reason = err instanceof HttpError ? err.message : "Enrolment failed unexpectedly";
    if (!(err instanceof HttpError)) console.error(`Enrolment after payment ${payment.id} failed:`, err);
    await prisma.payment.update({ where: { id: payment.id }, data: { enrollmentError: reason } });
    return { status: "NOT_ENROLLED", reason };
  }
}

/**
 * Marks the order's payment PAID exactly once, then records it and enrolls the lead.
 * Safe to call any number of times, from the checkout callback and the webhook alike.
 */
export async function confirmPaid(gatewayOrderId: string, gatewayPaymentId: string, source: "checkout" | "webhook") {
  const existing = await prisma.payment.findUnique({ where: { gatewayOrderId } });
  if (!existing) throw new HttpError(404, "No payment matches this order");
  if (existing.status === "PAID") {
    if (existing.gatewayPaymentId !== gatewayPaymentId) {
      console.error(`Order ${gatewayOrderId} is already paid by ${existing.gatewayPaymentId}; ignoring second payment ${gatewayPaymentId}`);
      throw new HttpError(409, "This order was already paid with a different payment. Check the gateway dashboard for a refund.");
    }
    return { payment: await getPayment(existing.id), enrollment: null, alreadyProcessed: true };
  }

  // Only one caller can move it to PAID: the update matches only while it isn't PAID yet.
  let won: number;
  try {
    ({ count: won } = await prisma.payment.updateMany({
      where: { id: existing.id, status: { not: "PAID" } },
      data: { status: "PAID", gatewayPaymentId, paidAt: new Date(), failureReason: null },
    }));
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new HttpError(409, "This payment id was already used for another order");
    }
    throw err;
  }
  if (won === 0) return { payment: await getPayment(existing.id), enrollment: null, alreadyProcessed: true };

  const payment = (await prisma.payment.findUnique({ where: { id: existing.id }, include: { batch: { select: { name: true } } } }))!;
  await prisma.leadActivity.create({
    data: {
      leadId: payment.leadId,
      actorId: source === "checkout" ? payment.createdById : null,
      type: "PAYMENT_RECEIVED",
      meta: { paymentId: payment.id, amountPaise: payment.amountPaise, currency: payment.currency, batchName: payment.batch.name, via: source },
    },
  });
  const lead = await prisma.lead.findUnique({ where: { id: payment.leadId }, select: { email: true } });
  if (lead) await enqueueEmail("payment-receipt", lead.email, { paymentId: payment.id });

  const enrollment = await enrollAfterPayment(payment);
  await invalidate(cacheKeys.dashboardStats()); // "Fees collected" changed
  return { payment: await getPayment(payment.id), enrollment, alreadyProcessed: false };
}

/** Step 3: the browser's checkout result, checked against the gateway's signature. */
export async function verifyCheckout(input: { orderId: string; gatewayPaymentId: string; signature: string }) {
  const gateway = requireGateway();
  if (!gateway.checkoutSignatureValid(input.orderId, input.gatewayPaymentId, input.signature)) {
    throw new HttpError(400, "Payment signature is invalid. The payment was not recorded.");
  }
  return confirmPaid(input.orderId, input.gatewayPaymentId, "checkout");
}

export async function markFailed(gatewayOrderId: string, reason: string) {
  await prisma.payment.updateMany({
    where: { gatewayOrderId, status: "CREATED" },
    data: { status: "FAILED", failureReason: reason.slice(0, 300) },
  });
}

type WebhookPaymentEntity = { id?: string; order_id?: string; amount?: number; currency?: string; error_description?: string };

/** Step 4: the gateway reporting directly. Unknown orders are acknowledged and ignored. */
export async function handleWebhook(rawBody: Buffer, signature: string | undefined) {
  const gateway = requireGateway();
  if (!gateway.webhookSignatureValid(rawBody, signature)) throw new HttpError(400, "Invalid webhook signature");

  let event: { event?: string; payload?: { payment?: { entity?: WebhookPaymentEntity } } };
  try {
    event = JSON.parse(rawBody.toString("utf8"));
  } catch {
    throw new HttpError(400, "Webhook body isn't JSON");
  }
  const entity = event.payload?.payment?.entity;
  if (!entity?.order_id || !entity.id) return { handled: false };

  const payment = await prisma.payment.findUnique({ where: { gatewayOrderId: entity.order_id }, select: { amountPaise: true, currency: true } });
  if (!payment) return { handled: false }; // not one of ours

  if (event.event === "payment.captured" || event.event === "order.paid") {
    // The amount must match what this server asked for.
    if (entity.amount !== payment.amountPaise || (entity.currency && entity.currency !== payment.currency)) {
      console.error(`Webhook amount mismatch for order ${entity.order_id}: got ${entity.amount} ${entity.currency}, expected ${payment.amountPaise}`);
      return { handled: false };
    }
    await confirmPaid(entity.order_id, entity.id, "webhook");
    return { handled: true };
  }
  if (event.event === "payment.failed") {
    await markFailed(entity.order_id, entity.error_description ?? "Payment failed");
    return { handled: true };
  }
  return { handled: false };
}

/** The test gateway's "checkout": returns what Razorpay's checkout would hand the browser. */
export async function completeFakeCheckout(orderId: string, outcome: "success" | "failure") {
  if (requireGateway().name !== "fake") throw new HttpError(404, "Not found");
  const payment = await prisma.payment.findUnique({ where: { gatewayOrderId: orderId }, select: { status: true } });
  if (!payment) throw new HttpError(404, "No payment matches this order");
  if (payment.status === "PAID") throw new HttpError(409, "This order is already paid");
  if (outcome === "failure") {
    await markFailed(orderId, "Declined by the test gateway");
    return { outcome };
  }
  const gatewayPaymentId = fakeId("pay");
  return { outcome, orderId, gatewayPaymentId, signature: signFakeCheckout(orderId, gatewayPaymentId) };
}

export async function getPayment(id: string) {
  return prisma.payment.findUniqueOrThrow({ where: { id }, select: paymentSelect });
}

export type PaymentStatusFilter = "PAID" | "FAILED" | "CREATED";
export interface ListPaymentsQuery {
  leadId?: string;
  status?: PaymentStatusFilter;
  batchId?: string;
  search?: string; // the payer's name or email, or a gateway payment id
  from?: string; // YYYY-MM-DD, on the day the payment was started
  to?: string;
  page: number;
  limit: number;
}

/**
 * Admin list with filters. The summary counts every status for the same filters
 * (except the status filter itself), so the totals stay visible while one status is shown.
 */
export async function listPayments(q: ListPaymentsQuery) {
  const toEnd = q.to ? new Date(toDbDate(q.to).getTime() + 24 * 3600 * 1000) : undefined; // "to" includes that whole day
  const base: Prisma.PaymentWhereInput = {
    ...(q.leadId && { leadId: q.leadId }),
    ...(q.batchId && { batchId: q.batchId }),
    ...((q.from || toEnd) && { createdAt: { ...(q.from && { gte: toDbDate(q.from) }), ...(toEnd && { lt: toEnd }) } }),
    ...(q.search && {
      OR: [
        { lead: { name: { contains: q.search, mode: "insensitive" } } },
        { lead: { email: { contains: q.search, mode: "insensitive" } } },
        { gatewayPaymentId: { contains: q.search } },
      ],
    }),
  };
  const where: Prisma.PaymentWhereInput = { ...base, ...(q.status && { status: q.status }) };

  const [items, total, byStatus] = await prisma.$transaction([
    prisma.payment.findMany({ where, orderBy: { createdAt: "desc" }, select: paymentSelect, ...toSkipTake(q) }),
    prisma.payment.count({ where }),
    prisma.payment.groupBy({ by: ["status"], where: base, orderBy: { status: "asc" }, _count: { _all: true }, _sum: { amountPaise: true } }),
  ]);
  const of = (s: PaymentStatusFilter) => byStatus.find((g) => g.status === s);
  const count = (s: PaymentStatusFilter) => (of(s)?._count as { _all?: number } | undefined)?._all ?? 0;
  const summary = {
    currency: CURRENCY,
    collectedPaise: of("PAID")?._sum?.amountPaise ?? 0,
    paid: count("PAID"),
    failed: count("FAILED"),
    pending: count("CREATED"),
  };
  return { ...paginated(items, total, q), summary };
}

/**
 * A student's own payments: those made for the lead they were enrolled from, plus any
 * made under their email (for example when enrolment after payment couldn't complete).
 * Only what a payer needs to see: no internal ids of who took it or enrolment errors.
 */
export async function myPayments(user: AuthUser) {
  const items = await prisma.payment.findMany({
    where: { lead: { OR: [{ convertedUserId: user.id }, { email: { equals: user.email, mode: "insensitive" } }] } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      amountPaise: true,
      currency: true,
      status: true,
      gatewayPaymentId: true,
      failureReason: true,
      createdAt: true,
      paidAt: true,
      batch: { select: { name: true, course: true } },
      lead: { select: { name: true } },
    },
  });
  const totalPaidPaise = items.filter((p) => p.status === "PAID").reduce((sum, p) => sum + p.amountPaise, 0);
  return { items, totalPaidPaise, currency: CURRENCY };
}
