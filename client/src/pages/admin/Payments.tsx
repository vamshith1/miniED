import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { CheckCircle2, Clock3, IndianRupee, Receipt, Search, X, XCircle } from "lucide-react";
import { api, qs } from "../../lib/api";
import { fmtDateTime, fmtMoney } from "../../lib/format";
import type { Batch, Payment, PaymentList } from "../../lib/types";
import { AnimatedNumber, Button, Card, EmptyState, Input, PageHeader, Pagination, QueryState, Select, Stat, Table, Td, Th, cx } from "../../components/ui";
import { PaymentStatusBadge, ReceiptModal, usePaymentConfig, type ReceiptData } from "../../components/Payments";

type StatusFilter = "" | Payment["status"];

const toReceipt = (p: Payment): ReceiptData => ({
  id: p.id,
  payerName: p.lead.name,
  amountPaise: p.amountPaise,
  currency: p.currency,
  course: p.batch.course,
  batchName: p.batch.name,
  paidAt: p.paidAt,
  gatewayPaymentId: p.gatewayPaymentId,
});

/**
 * Every fee payment in one place: totals for the current filters, then a table where
 * each row opens the student (lead) it belongs to. Filters live in the URL, so a
 * filtered view can be bookmarked or shared.
 */
export function PaymentsPage() {
  const config = usePaymentConfig();
  const [params, setParams] = useSearchParams();
  const filters = {
    search: params.get("search") ?? "",
    status: (params.get("status") ?? "") as StatusFilter,
    batchId: params.get("batchId") ?? "",
    from: params.get("from") ?? "",
    to: params.get("to") ?? "",
    page: Number(params.get("page") ?? 1),
  };
  const [searchText, setSearchText] = useState(filters.search);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const filtered = !!(filters.search || filters.status || filters.batchId || filters.from || filters.to);
  // The totals ignore the status filter (so all three counts stay visible); only the others narrow them.
  const totalsFiltered = !!(filters.search || filters.batchId || filters.from || filters.to);

  const update = (patch: Partial<typeof filters>) => {
    const next = { ...filters, page: 1, ...patch };
    setParams(qs({ ...next, page: next.page > 1 ? next.page : undefined }), { replace: true });
  };
  const clear = () => {
    setSearchText("");
    setParams({}, { replace: true });
  };

  const batches = useQuery({ queryKey: ["batches"], queryFn: () => api.get<{ items: Batch[] }>("/batches").then((r) => r.items) });
  const payments = useQuery({
    queryKey: ["payments-list", filters],
    queryFn: () => api.get<PaymentList>(`/payments${qs({ ...filters, limit: 20 })}`),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000, // a payment confirmed by the gateway's webhook shows up on its own
  });
  const s = payments.data?.summary;

  // The summary cards double as status filters: click one to show only those payments.
  const statusCard = (status: StatusFilter, props: Parameters<typeof Stat>[0]) => (
    <button
      type="button"
      onClick={() => update({ status: filters.status === status ? "" : status })}
      aria-pressed={filters.status === status}
      className={cx("animate-fade-up rounded-lg text-left", filters.status === status && "ring-2 ring-brand/60")}
    >
      <Stat {...props} interactive />
    </button>
  );

  return (
    <>
      <PageHeader title="Payments" subtitle="Every course-fee payment: what came in, what failed, and what was never completed." />

      {config.data && !config.data.enabled && (
        <div className="mb-4 rounded-md border border-warn/30 bg-warn-soft px-3 py-2 text-sm text-warn">
          Payments are switched off on this server, so no new ones can be taken. Past payments are still listed.
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="animate-fade-up">
          <Stat
            label={totalsFiltered ? "Collected (filtered)" : "Collected"}
            icon={<IndianRupee className="size-4" />}
            tone="good"
            value={s ? <AnimatedNumber value={s.collectedPaise} format={(n) => fmtMoney(Math.round(n), s.currency)} /> : "…"}
            hint={s ? `${s.paid} successful payment${s.paid === 1 ? "" : "s"}` : undefined}
          />
        </div>
        {statusCard("PAID", { label: "Successful", icon: <CheckCircle2 className="size-4" />, tone: "good", value: s ? <AnimatedNumber value={s.paid} /> : "…", hint: "Click to show only these" })}
        {statusCard("FAILED", { label: "Failed", icon: <XCircle className="size-4" />, tone: s?.failed ? "bad" : undefined, value: s ? <AnimatedNumber value={s.failed} /> : "…", hint: "Declined or errored, nothing charged" })}
        {statusCard("CREATED", { label: "Not completed", icon: <Clock3 className="size-4" />, value: s ? <AnimatedNumber value={s.pending} /> : "…", hint: "Checkout opened, never finished" })}
      </div>

      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <form
            className="relative min-w-[200px] flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              update({ search: searchText.trim() });
            }}
          >
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-faint" />
            <Input
              className="pl-8"
              placeholder="Student name, email or payment ID"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              onBlur={() => searchText.trim() !== filters.search && update({ search: searchText.trim() })}
              aria-label="Search payments"
            />
          </form>
          <Select className="w-auto" value={filters.status} onChange={(e) => update({ status: e.target.value as StatusFilter })} aria-label="Status">
            <option value="">All statuses</option>
            <option value="PAID">Paid</option>
            <option value="FAILED">Failed</option>
            <option value="CREATED">Not completed</option>
          </Select>
          <Select className="w-auto max-w-[200px]" value={filters.batchId} onChange={(e) => update({ batchId: e.target.value })} aria-label="Batch">
            <option value="">All batches</option>
            {batches.data
              ?.filter((b) => b.feePaise)
              .map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
          </Select>
          <label className="flex items-center gap-1.5 text-sm text-muted">
            From
            <Input type="date" className="w-auto" value={filters.from} max={filters.to || undefined} onChange={(e) => update({ from: e.target.value })} />
          </label>
          <label className="flex items-center gap-1.5 text-sm text-muted">
            to
            <Input type="date" className="w-auto" value={filters.to} min={filters.from || undefined} onChange={(e) => update({ to: e.target.value })} />
          </label>
          {filtered && (
            <Button variant="ghost" size="sm" onClick={clear}>
              <X className="size-4" /> Clear
            </Button>
          )}
        </div>

        <QueryState query={payments}>
          {(data) =>
            data.items.length === 0 ? (
              <EmptyState title={filtered ? "No payments match" : "No payments yet"}>
                {filtered ? "Try clearing the filters." : "Fees are collected from a lead's “Enroll as student” when the batch has a fee."}
              </EmptyState>
            ) : (
              <>
                <Table>
                  <thead>
                    <tr>
                      <Th>Date</Th>
                      <Th>Student</Th>
                      <Th>Course</Th>
                      <Th className="text-right">Amount</Th>
                      <Th>Status</Th>
                      <Th>
                        <span className="sr-only">Receipt</span>
                      </Th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((p) => (
                      <tr key={p.id}>
                        <Td className="whitespace-nowrap text-muted">{fmtDateTime(p.paidAt ?? p.createdAt)}</Td>
                        <Td>
                          <Link to={`/leads/${p.lead.id}`} className="font-medium text-ink transition-colors hover:text-brand-strong">
                            {p.lead.name}
                          </Link>
                          <div className="text-xs text-muted">{p.lead.email}</div>
                        </Td>
                        <Td>
                          <div>{p.batch.course}</div>
                          <div className="text-xs text-muted">{p.batch.name}</div>
                        </Td>
                        <Td className="whitespace-nowrap text-right font-semibold tabular-nums">{fmtMoney(p.amountPaise, p.currency)}</Td>
                        <Td>
                          <PaymentStatusBadge status={p.status} />
                          {p.status === "FAILED" && p.failureReason && <div className="mt-1 max-w-[220px] text-xs text-bad">{p.failureReason}</div>}
                          {p.enrollmentError && <div className="mt-1 max-w-[220px] text-xs text-warn">Not enrolled: {p.enrollmentError}</div>}
                          {p.gatewayPaymentId && <div className="mt-1 truncate font-mono text-xs text-faint">{p.gatewayPaymentId}</div>}
                          {p.provider === "fake" && <div className="text-xs text-faint">test gateway</div>}
                        </Td>
                        <Td className="text-right">
                          {p.status === "PAID" && (
                            <Button size="sm" variant="ghost" onClick={() => setReceipt(toReceipt(p))} aria-label={`Receipt for ${p.lead.name}`}>
                              <Receipt className="size-4" /> Receipt
                            </Button>
                          )}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
                <div className="flex items-center justify-between border-t border-line px-4 py-2 text-xs text-muted">
                  <span>
                    {data.total} payment{data.total === 1 ? "" : "s"}
                  </span>
                </div>
                <Pagination page={data.page} totalPages={data.totalPages} onPage={(page) => update({ page })} />
              </>
            )
          }
        </QueryState>
      </Card>

      <ReceiptModal receipt={receipt} onClose={() => setReceipt(null)} />
    </>
  );
}
