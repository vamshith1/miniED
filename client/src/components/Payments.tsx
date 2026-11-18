import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Clock3, Printer, XCircle } from "lucide-react";
import { api } from "../lib/api";
import { fmtDateTime, fmtMoney } from "../lib/format";
import type { Payment, PaymentConfig } from "../lib/types";
import { Badge, Button, Modal } from "./ui";

/** Whether payments are switched on, the gateway and its public key. Cached for the session. */
export const usePaymentConfig = (enabled = true) =>
  useQuery({ queryKey: ["payments-config"], queryFn: () => api.get<PaymentConfig>("/payments/config"), staleTime: Infinity, enabled });

type Status = Payment["status"];

// CREATED means the order exists but the payer never finished: shown as "Not completed".
export const paymentStatusLabel = (s: Status) => (s === "PAID" ? "Paid" : s === "FAILED" ? "Failed" : "Not completed");

export function PaymentStatusBadge({ status }: { status: Status }) {
  const Icon = status === "PAID" ? CheckCircle2 : status === "FAILED" ? XCircle : Clock3;
  return (
    <Badge tone={status === "PAID" ? "good" : status === "FAILED" ? "bad" : "warn"}>
      <Icon className="mr-1 size-3" aria-hidden />
      {paymentStatusLabel(status)}
    </Badge>
  );
}

export interface ReceiptData {
  id: string;
  payerName: string;
  amountPaise: number;
  currency: string;
  course: string;
  batchName: string;
  paidAt: string | null;
  gatewayPaymentId: string | null;
}

/** A printable receipt for a successful payment (Print prints only the receipt). */
export function ReceiptModal({ receipt, onClose }: { receipt: ReceiptData | null; onClose: () => void }) {
  const rows: [string, string][] = receipt
    ? [
        ["Received from", receipt.payerName],
        ["Course", `${receipt.course} (${receipt.batchName})`],
        ["Paid on", fmtDateTime(receipt.paidAt)],
        ["Payment ID", receipt.gatewayPaymentId ?? "—"],
        ["Receipt no.", receipt.id],
      ]
    : [];
  return (
    <Modal open={!!receipt} onClose={onClose} title="Payment receipt">
      {receipt && (
        <div className="space-y-4">
          <div className="print-receipt space-y-4 rounded-lg border border-line p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted">MiniEdCRM · Receipt</p>
                <p className="mt-1 text-3xl font-semibold tabular-nums">{fmtMoney(receipt.amountPaise, receipt.currency)}</p>
              </div>
              <PaymentStatusBadge status="PAID" />
            </div>
            <dl className="divide-y divide-line text-sm">
              {rows.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 py-2">
                  <dt className="text-muted">{k}</dt>
                  <dd className="break-all text-right font-medium">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="text-xs text-faint">This receipt was also emailed when the payment was made.</p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
            <Button onClick={() => window.print()}>
              <Printer className="size-4" /> Print
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
