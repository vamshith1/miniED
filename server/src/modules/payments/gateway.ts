import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "../../config/env.js";
import { HttpError } from "../../lib/http-error.js";

/**
 * The payment gateway, behind one small interface so the rest of the app doesn't
 * care which one is in use:
 *   - razorpay: the real gateway (test keys rzp_test_..., or live keys)
 *   - fake:     a stand-in for development and tests. It signs results exactly like
 *               Razorpay does, with a secret derived from JWT_SECRET, so the same
 *               verification code runs. Refused in production (config/env.ts).
 *
 * Both sign with HMAC-SHA256:
 *   checkout result = HMAC(order_id + "|" + payment_id, key secret)
 *   webhook         = HMAC(raw request body, webhook secret), header X-Razorpay-Signature
 */
export type ProviderName = "razorpay" | "fake";

export interface Gateway {
  name: ProviderName;
  keyId: string | null; // public key for the browser checkout
  createOrder(input: { amountPaise: number; currency: string; receipt: string; notes: Record<string, string> }): Promise<{ orderId: string }>;
  checkoutSignatureValid(orderId: string, paymentId: string, signature: string): boolean;
  webhookSignatureValid(rawBody: Buffer, signature: string | undefined): boolean;
}

const hmac = (secret: string | Buffer, data: string | Buffer) => createHmac("sha256", secret).update(data).digest("hex");

// Constant-time comparison, so response timing doesn't reveal how much of a forged signature was right.
function sameHex(expected: string, given: string | undefined) {
  if (!given || given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(given));
}

// ---------- Razorpay

const RAZORPAY_API = "https://api.razorpay.com/v1";

function razorpay(): Gateway {
  const keyId = env.RAZORPAY_KEY_ID!;
  const keySecret = env.RAZORPAY_KEY_SECRET!;
  const webhookSecret = env.RAZORPAY_WEBHOOK_SECRET!;
  return {
    name: "razorpay",
    keyId,
    async createOrder({ amountPaise, currency, receipt, notes }) {
      let res: Response;
      try {
        res = await fetch(`${RAZORPAY_API}/orders`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`,
          },
          body: JSON.stringify({ amount: amountPaise, currency, receipt, notes }),
          signal: AbortSignal.timeout(15_000),
        });
      } catch (err) {
        throw new HttpError(502, `Couldn't reach the payment gateway: ${(err as Error).message}`);
      }
      const body = (await res.json().catch(() => ({}))) as { id?: string; error?: { description?: string } };
      if (!res.ok || !body.id) {
        // Never echo the key; the gateway's own description is safe to show to an admin.
        throw new HttpError(502, `The payment gateway refused the order: ${body.error?.description ?? `HTTP ${res.status}`}`);
      }
      return { orderId: body.id };
    },
    checkoutSignatureValid: (orderId, paymentId, signature) => sameHex(hmac(keySecret, `${orderId}|${paymentId}`), signature),
    webhookSignatureValid: (rawBody, signature) => sameHex(hmac(webhookSecret, rawBody), signature),
  };
}

// ---------- Test gateway

const fakeSecret = (purpose: string) => createHash("sha256").update(`fake-gateway:${purpose}:${env.JWT_SECRET}`).digest();

export function signFakeCheckout(orderId: string, paymentId: string) {
  return hmac(fakeSecret("checkout"), `${orderId}|${paymentId}`);
}
export function signFakeWebhook(rawBody: string | Buffer) {
  return hmac(fakeSecret("webhook"), rawBody);
}
export const fakeId = (prefix: "order" | "pay") => `${prefix}_fake_${randomBytes(9).toString("base64url")}`;

function fake(): Gateway {
  return {
    name: "fake",
    keyId: null,
    async createOrder() {
      return { orderId: fakeId("order") };
    },
    checkoutSignatureValid: (orderId, paymentId, signature) => sameHex(signFakeCheckout(orderId, paymentId), signature),
    webhookSignatureValid: (rawBody, signature) => sameHex(signFakeWebhook(rawBody), signature),
  };
}

// ---------- Selection

let gateway: Gateway | null | undefined;

/** The configured gateway, or null when PAYMENT_PROVIDER=off. */
export function getGateway(): Gateway | null {
  if (gateway === undefined) gateway = env.PAYMENT_PROVIDER === "razorpay" ? razorpay() : env.PAYMENT_PROVIDER === "fake" ? fake() : null;
  return gateway;
}

export function requireGateway(): Gateway {
  const g = getGateway();
  if (!g) throw new HttpError(503, "Payments aren't set up on this server (PAYMENT_PROVIDER=off)");
  return g;
}
