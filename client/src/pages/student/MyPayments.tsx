import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, IndianRupee, Receipt, Wallet } from "lucide-react";
import { api } from "../../lib/api";
import { useUser } from "../../lib/auth";
import { fmtDateTime, fmtMoney } from "../../lib/format";
import type { MyPayment } from "../../lib/types";
import { AnimatedNumber, Button, Card, EmptyState, PageHeader, QueryState, Stat } from "../../components/ui";
import { PaymentStatusBadge, ReceiptModal, type ReceiptData } from "../../components/Payments";

// What each status means for the person who paid.
const explain = (p: MyPayment) =>
  p.status === "PAID"
    ? `Paid ${fmtDateTime(p.paidAt)}`
    : p.status === "FAILED"
      ? `Didn't go through${p.failureReason ? `: ${p.failureReason}` : ""}. Nothing was charged.`
      : `Started ${fmtDateTime(p.createdAt)} but not completed. Nothing was charged.`;

export function MyPaymentsPage() {
  const user = useUser();
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const payments = useQuery({
    queryKey: ["my-payments"],
    queryFn: () => api.get<{ items: MyPayment[]; totalPaidPaise: number; currency: string }>("/payments/mine"),
  });

  return (
    <>
      <PageHeader title="My payments" subtitle="Your course-fee payments and receipts." />
      <QueryState query={payments}>
        {(data) => {
          const paid = data.items.filter((p) => p.status === "PAID");
          const last = paid[0];
          return (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="animate-fade-up">
                  <Stat
                    label="Total paid"
                    icon={<IndianRupee className="size-4" />}
                    tone={data.totalPaidPaise ? "good" : undefined}
                    value={<AnimatedNumber value={data.totalPaidPaise} format={(n) => fmtMoney(Math.round(n), data.currency)} />}
                    hint={`${paid.length} successful payment${paid.length === 1 ? "" : "s"}`}
                  />
                </div>
                <div className="animate-fade-up" style={{ animationDelay: "50ms" }}>
                  <Stat label="Last payment" icon={<CalendarClock className="size-4" />} value={last ? fmtMoney(last.amountPaise, last.currency) : "—"} hint={last ? fmtDateTime(last.paidAt) : "None yet"} />
                </div>
                <div className="animate-fade-up" style={{ animationDelay: "100ms" }}>
                  <Stat label="Attempts" icon={<Wallet className="size-4" />} value={data.items.length} hint="Including failed or unfinished ones" />
                </div>
              </div>

              <Card title="History" padded={false}>
                {data.items.length === 0 ? (
                  <EmptyState title="No payments yet">When you pay a course fee, it shows up here with a receipt.</EmptyState>
                ) : (
                  <ul className="divide-y divide-line">
                    {data.items.map((p, i) => (
                      <li key={p.id} className="animate-fade-up flex flex-wrap items-center gap-3 px-4 py-3 transition-colors hover:bg-brand-soft/30" style={{ animationDelay: `${150 + i * 40}ms` }}>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">
                            {p.batch.course} <span className="font-normal text-muted">· {p.batch.name}</span>
                          </p>
                          <p className={p.status === "FAILED" ? "text-sm text-bad" : "text-sm text-muted"}>{explain(p)}</p>
                          {p.gatewayPaymentId && p.status === "PAID" && <p className="truncate font-mono text-xs text-faint">{p.gatewayPaymentId}</p>}
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="font-semibold tabular-nums">{fmtMoney(p.amountPaise, p.currency)}</span>
                          <PaymentStatusBadge status={p.status} />
                          {p.status === "PAID" && (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() =>
                                setReceipt({
                                  id: p.id,
                                  payerName: p.lead.name || user.name,
                                  amountPaise: p.amountPaise,
                                  currency: p.currency,
                                  course: p.batch.course,
                                  batchName: p.batch.name,
                                  paidAt: p.paidAt,
                                  gatewayPaymentId: p.gatewayPaymentId,
                                })
                              }
                            >
                              <Receipt className="size-4" /> Receipt
                            </Button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              <p className="text-xs text-faint">A payment that failed or wasn't completed never charges you. Questions about a payment? Contact the institute with its receipt number.</p>
            </div>
          );
        }}
      </QueryState>
      <ReceiptModal receipt={receipt} onClose={() => setReceipt(null)} />
    </>
  );
}
