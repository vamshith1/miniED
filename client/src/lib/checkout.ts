import type { CheckoutInfo, CheckoutResult } from "./types";

/**
 * Opens Razorpay's checkout popup for an order the server created, and resolves with
 * the signed result (which the server then verifies) or null if the payer closed it.
 * A failed attempt keeps the popup open so the payer can try another method.
 * The test gateway has its own screen inside the app instead (see LeadDetail).
 */
type RazorpayResponse = { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string };
type RazorpayInstance = { open: () => void };
type RazorpayCtor = new (options: Record<string, unknown>) => RazorpayInstance;

declare global {
  interface Window {
    Razorpay?: RazorpayCtor;
  }
}

const SCRIPT_URL = "https://checkout.razorpay.com/v1/checkout.js";
let loading: Promise<RazorpayCtor> | null = null;

function loadRazorpay(): Promise<RazorpayCtor> {
  if (window.Razorpay) return Promise.resolve(window.Razorpay);
  loading ??= new Promise<RazorpayCtor>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SCRIPT_URL;
    s.async = true;
    s.onload = () => (window.Razorpay ? resolve(window.Razorpay) : reject(new Error("Razorpay checkout didn't load")));
    s.onerror = () => {
      loading = null; // allow a retry
      reject(new Error("Couldn't load Razorpay checkout. Check the internet connection and try again."));
    };
    document.head.appendChild(s);
  });
  return loading;
}

export async function openRazorpayCheckout(c: CheckoutInfo): Promise<CheckoutResult | null> {
  const Razorpay = await loadRazorpay();
  return new Promise((resolve) => {
    const rzp = new Razorpay({
      key: c.keyId,
      order_id: c.orderId,
      amount: c.amountPaise,
      currency: c.currency,
      name: "MiniEdCRM",
      description: c.description,
      prefill: c.prefill,
      theme: { color: "#3858e9" },
      handler: (r: RazorpayResponse) => resolve({ orderId: r.razorpay_order_id, gatewayPaymentId: r.razorpay_payment_id, signature: r.razorpay_signature }),
      modal: { ondismiss: () => resolve(null) },
    });
    rzp.open();
  });
}
