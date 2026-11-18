import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, CreditCard, GraduationCap, Trash2 } from "lucide-react";
import { openRazorpayCheckout } from "../../lib/checkout";
import { api } from "../../lib/api";
import { fmtDateTime, fmtMoney, relative, titleCase } from "../../lib/format";
import {
  STAGES,
  type Batch,
  type CheckoutInfo,
  type CheckoutResult,
  type Lead,
  type LeadActivity,
  type LeadNote,
  type LeadStage,
  type Paginated,
  type Payment,
  type PaymentConfig,
  type VerifyResult,
} from "../../lib/types";
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Modal, PageHeader, QueryState, Select, Spinner, TextField, Textarea, fieldErrorsOf, stageTone, askConfirm } from "../../components/ui";
import { FollowUp, useAssignees } from "./Leads";

export function LeadDetailPage() {
  const { id } = useParams();
  const lead = useQuery({ queryKey: ["lead", id], queryFn: () => api.get<{ lead: Lead }>(`/leads/${id}`).then((r) => r.lead) });
  return (
    <>
      <Link to="/leads" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Leads
      </Link>
      <QueryState query={lead}>{(l) => <LeadView lead={l} />}</QueryState>
    </>
  );
}

function LeadView({ lead }: { lead: Lead }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [converting, setConverting] = useState(false);
  const enrolled = lead.stage === "ENROLLED";
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["lead", lead.id] });
    qc.invalidateQueries({ queryKey: ["timeline", lead.id] });
    qc.invalidateQueries({ queryKey: ["leads"] });
    qc.invalidateQueries({ queryKey: ["payments", lead.id] });
  };
  const remove = useMutation({
    mutationFn: () => api.del(`/leads/${lead.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leads"] });
      navigate("/leads");
    },
  });

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {lead.name} <Badge tone={stageTone(lead.stage)}>{titleCase(lead.stage)}</Badge>
          </span>
        }
        subtitle={`${lead.email}${lead.phone ? ` · ${lead.phone}` : ""} · added ${relative(lead.createdAt)} by ${lead.createdBy.name}`}
        actions={
          enrolled ? (
            <Badge tone="good">Enrolled as a student</Badge>
          ) : (
            <>
              <Button
                variant="danger"
                loading={remove.isPending}
                onClick={async () => (await askConfirm(`Delete ${lead.name}? Their notes and timeline are deleted too.`, { confirmLabel: "Delete", danger: true })) && remove.mutate()}
              >
                <Trash2 className="size-4" /> Delete
              </Button>
              <Button onClick={() => setConverting(true)}>
                <GraduationCap className="size-4" /> Enroll as student
              </Button>
            </>
          )
        }
      />
      <ErrorBox error={remove.error} />

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          {/* key: reset the form to the saved values after each save */}
          {enrolled ? <ReadOnlyDetails lead={lead} /> : <EditDetails key={lead.updatedAt} lead={lead} onSaved={refresh} />}
          <Notes leadId={lead.id} onAdded={refresh} />
        </div>
        <div className="space-y-4">
          {!enrolled && <StageCard lead={lead} onChanged={refresh} />}
          <Payments leadId={lead.id} />
          <Timeline leadId={lead.id} />
        </div>
      </div>

      <ConvertModal lead={lead} open={converting} onClose={() => setConverting(false)} onDone={refresh} />
    </>
  );
}

function ReadOnlyDetails({ lead }: { lead: Lead }) {
  const rows: [string, string][] = [
    ["Source", lead.source ?? "—"],
    ["Course interest", lead.courseInterest ?? "—"],
    ["Assigned to", lead.assignedTo?.name ?? "Unassigned"],
  ];
  return (
    <Card title="Details">
      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt className="text-muted">{k}</dt>
            <dd className="font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs text-faint">Enrolled leads are locked. Manage the student from their batch.</p>
    </Card>
  );
}

function EditDetails({ lead, onSaved }: { lead: Lead; onSaved: () => void }) {
  const assignees = useAssignees();
  const initial = {
    name: lead.name,
    email: lead.email,
    phone: lead.phone ?? "",
    source: lead.source ?? "",
    courseInterest: lead.courseInterest ?? "",
    nextFollowUpAt: lead.nextFollowUpAt ? new Date(lead.nextFollowUpAt).toLocaleDateString("en-CA") : "",
    assignedToId: lead.assignedToId ?? "",
  };
  const [form, setForm] = useState(initial);
  const changed = JSON.stringify(form) !== JSON.stringify(initial);
  const save = useMutation({
    mutationFn: () =>
      api.patch(`/leads/${lead.id}`, {
        ...form,
        nextFollowUpAt: form.nextFollowUpAt || null,
        assignedToId: form.assignedToId || null,
      }),
    onSuccess: onSaved,
  });
  const fe = fieldErrorsOf(save.error);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  return (
    <Card title="Details" actions={<FollowUp lead={lead} />}>
      <form
        className="space-y-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Name" required value={form.name} onChange={set("name")} error={fe.name} />
          <TextField label="Email" type="email" required value={form.email} onChange={set("email")} error={fe.email} />
          <TextField label="Phone" value={form.phone} onChange={set("phone")} error={fe.phone} />
          <TextField label="Source" value={form.source} onChange={set("source")} error={fe.source} />
          <TextField label="Course interest" value={form.courseInterest} onChange={set("courseInterest")} error={fe.courseInterest} />
          <TextField label="Next follow-up" type="date" value={form.nextFollowUpAt} onChange={set("nextFollowUpAt")} error={fe.nextFollowUpAt} hint={lead.stage === "LOST" ? "Lost leads get no reminders" : undefined} />
        </div>
        <Field label="Assigned to">
          <Select value={form.assignedToId} onChange={set("assignedToId")}>
            <option value="">Unassigned</option>
            {assignees.data?.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({titleCase(u.role)})
              </option>
            ))}
          </Select>
        </Field>
        {Object.keys(fe).length === 0 && <ErrorBox error={save.error} />}
        <div className="flex justify-end gap-2">
          {changed && (
            <Button type="button" variant="ghost" onClick={() => setForm(initial)}>
              Undo changes
            </Button>
          )}
          <Button type="submit" disabled={!changed} loading={save.isPending}>
            Save
          </Button>
        </div>
      </form>
    </Card>
  );
}

function StageCard({ lead, onChanged }: { lead: Lead; onChanged: () => void }) {
  const [stage, setStage] = useState<LeadStage>(lead.stage);
  const [note, setNote] = useState("");
  const change = useMutation({
    mutationFn: () => api.patch(`/leads/${lead.id}/stage`, { stage, ...(note.trim() && { note: note.trim() }) }),
    onSuccess: () => {
      setNote("");
      onChanged();
    },
  });
  return (
    <Card title="Stage">
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {STAGES.filter((s) => s !== "ENROLLED").map((s) => (
            <button
              key={s}
              onClick={() => setStage(s)}
              aria-pressed={stage === s}
              className={`rounded-full border px-3 py-1 text-sm ${stage === s ? "border-brand bg-brand-soft font-medium text-brand-strong" : "border-line text-muted hover:text-ink"}`}
            >
              {titleCase(s)}
            </button>
          ))}
        </div>
        <Textarea rows={2} placeholder={stage === "LOST" ? "Why was it lost? (optional)" : "Note for the timeline (optional)"} value={note} onChange={(e) => setNote(e.target.value)} aria-label="Stage note" />
        <ErrorBox error={change.error} />
        <Button className="w-full" disabled={stage === lead.stage} loading={change.isPending} onClick={() => change.mutate()}>
          {stage === lead.stage ? `Currently ${titleCase(stage)}` : `Move to ${titleCase(stage)}`}
        </Button>
        <p className="text-xs text-faint">To enroll, use “Enroll as student”: it creates their account.</p>
      </div>
    </Card>
  );
}

function Notes({ leadId, onAdded }: { leadId: string; onAdded: () => void }) {
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const notes = useQuery({ queryKey: ["notes", leadId], queryFn: () => api.get<Paginated<LeadNote>>(`/leads/${leadId}/notes?limit=50`) });
  const add = useMutation({
    mutationFn: () => api.post(`/leads/${leadId}/notes`, { body: body.trim() }),
    onSuccess: () => {
      setBody("");
      qc.invalidateQueries({ queryKey: ["notes", leadId] });
      onAdded();
    },
  });
  return (
    <Card title="Notes">
      <form
        className="mb-4 space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (body.trim()) add.mutate();
        }}
      >
        <Textarea rows={3} placeholder="What happened on the call?" value={body} onChange={(e) => setBody(e.target.value)} aria-label="New note" />
        <ErrorBox error={add.error} />
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={!body.trim()} loading={add.isPending}>
            Add note
          </Button>
        </div>
      </form>
      <QueryState query={notes}>
        {(data) =>
          data.items.length === 0 ? (
            <p className="text-sm text-muted">No notes yet.</p>
          ) : (
            <ul className="space-y-3">
              {data.items.map((n) => (
                <li key={n.id} className="rounded-md bg-canvas px-3 py-2">
                  <p className="whitespace-pre-wrap text-sm">{n.body}</p>
                  <p className="mt-1 text-xs text-faint">
                    {n.author.name} · {fmtDateTime(n.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          )
        }
      </QueryState>
    </Card>
  );
}

function describe(a: LeadActivity) {
  const m = (a.meta ?? {}) as Record<string, string | null | undefined>;
  switch (a.type) {
    case "CREATED":
      return "Lead created";
    case "IMPORTED":
      return `Imported from ${m.file ?? "a CSV file"}`;
    case "STAGE_CHANGED":
      return `${titleCase(m.from ?? "")} → ${titleCase(m.to ?? "")}${m.note ? `: “${m.note}”` : ""}`;
    case "NOTE_ADDED":
      return `Note: “${m.preview ?? ""}”`;
    case "ASSIGNED":
      return m.to ? "Assignment changed" : "Unassigned";
    case "CONVERTED":
      return `Enrolled in ${m.batchName ?? "a batch"}`;
    case "REMINDER_SENT":
      return `Follow-up reminder emailed to ${m.to ?? "the assignee"}`;
    case "PAYMENT_RECEIVED":
      return `Paid ${fmtMoney(Number(m.amountPaise), m.currency ?? "INR")} for ${m.batchName ?? "a batch"}${m.via === "webhook" ? " (confirmed by the gateway)" : ""}`;
  }
}

function Timeline({ leadId }: { leadId: string }) {
  const timeline = useQuery({ queryKey: ["timeline", leadId], queryFn: () => api.get<Paginated<LeadActivity>>(`/leads/${leadId}/timeline?limit=50`) });
  return (
    <Card title="Timeline">
      <QueryState query={timeline}>
        {(data) =>
          data.items.length === 0 ? (
            <EmptyState title="Nothing yet" />
          ) : (
            <ol className="relative space-y-4 border-l border-line pl-4">
              {data.items.map((a) => (
                <li key={a.id} className="relative">
                  <span className="absolute -left-[21px] top-1.5 size-2.5 rounded-full border-2 border-surface bg-brand" />
                  <p className="text-sm">{describe(a)}</p>
                  <p className="text-xs text-faint">
                    {a.actor?.name ?? "System"} · {fmtDateTime(a.createdAt)}
                  </p>
                </li>
              ))}
            </ol>
          )
        }
      </QueryState>
    </Card>
  );
}

const usePaymentConfig = (enabled = true) =>
  useQuery({ queryKey: ["payments-config"], queryFn: () => api.get<PaymentConfig>("/payments/config"), staleTime: Infinity, enabled });

type Step = "form" | "fake-checkout" | "verifying" | "paid" | "declined" | "enrolled";

function ConvertModal({ lead, open, onClose, onDone }: { lead: Lead; open: boolean; onClose: () => void; onDone: () => void }) {
  const batches = useQuery({ queryKey: ["batches"], queryFn: () => api.get<{ items: Batch[] }>("/batches").then((r) => r.items), enabled: open });
  const config = usePaymentConfig(open);
  const [batchId, setBatchId] = useState("");
  const [password, setPassword] = useState("");
  const [step, setStep] = useState<Step>("form");
  const [checkout, setCheckout] = useState<CheckoutInfo | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const batch = batches.data?.find((b) => b.id === batchId);
  const fee = batch?.feePaise ?? 0;
  const canCollect = !!config.data?.enabled && fee > 0;

  const convert = useMutation({
    mutationFn: () =>
      api.post<{ welcomeEmail: { status: string }; temporaryPassword?: string }>(`/leads/${lead.id}/convert`, { batchId, ...(password && { password }) }),
    onSuccess: () => {
      setStep("enrolled");
      onDone();
    },
  });
  const order = useMutation({ mutationFn: () => api.post<{ checkout: CheckoutInfo }>("/payments/orders", { leadId: lead.id, batchId }) });
  const verify = useMutation({
    mutationFn: (r: CheckoutResult) => api.post<VerifyResult>("/payments/verify", r),
    onSuccess: () => {
      setStep("paid");
      onDone();
    },
    onError: () => setStep("form"),
  });
  const fakePay = useMutation({
    mutationFn: (outcome: "success" | "failure") =>
      api.post<{ outcome: string } & Partial<CheckoutResult>>("/payments/fake/complete", { orderId: checkout!.orderId, outcome }),
    onSuccess: (r) => {
      if (r.outcome === "success" && r.gatewayPaymentId && r.signature && r.orderId) {
        setStep("verifying");
        verify.mutate({ orderId: r.orderId, gatewayPaymentId: r.gatewayPaymentId, signature: r.signature });
      } else {
        setStep("declined");
      }
    },
  });

  // Starts (or retries, on the same order) the gateway's checkout.
  async function collect() {
    setNotice(null);
    let co = checkout;
    if (!co) {
      try {
        co = (await order.mutateAsync()).checkout;
      } catch {
        return; // shown by the error box
      }
      setCheckout(co);
    }
    if (co.provider === "fake") {
      setStep("fake-checkout");
      return;
    }
    try {
      const result = await openRazorpayCheckout(co);
      if (!result) {
        setNotice("The payment window was closed. Nothing was charged; you can try again.");
        return;
      }
      setStep("verifying");
      verify.mutate(result);
    } catch (err) {
      setNotice((err as Error).message);
    }
  }

  const close = () => {
    if (step === "verifying") return; // don't hide a payment that's being confirmed
    convert.reset();
    order.reset();
    verify.reset();
    fakePay.reset();
    setPassword("");
    setCheckout(null);
    setNotice(null);
    setStep("form");
    onClose();
  };
  const fe = fieldErrorsOf(convert.error);

  return (
    <Modal open={open} onClose={close} title={step === "fake-checkout" ? "Test checkout" : `Enroll ${lead.name}`}>
      {step === "enrolled" && convert.data ? (
        <div className="space-y-3 text-sm">
          <p>
            <b>{lead.name}</b> now has a student account and is in the batch.
          </p>
          <TemporaryPasswordNote password={convert.data.temporaryPassword} email={lead.email} chosen={!!password} />
          <div className="flex justify-end">
            <Button onClick={close}>Done</Button>
          </div>
        </div>
      ) : step === "paid" && verify.data ? (
        <PaidSummary result={verify.data} lead={lead} onClose={close} />
      ) : step === "fake-checkout" && checkout ? (
        <div className="space-y-4 text-sm">
          <div className="rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 text-warn">
            Test gateway: no real money moves. With Razorpay keys set, Razorpay's own checkout opens here instead.
          </div>
          <div className="rounded-lg border border-line p-4">
            <p className="text-muted">{checkout.description}</p>
            <p className="mt-1 text-3xl font-semibold tabular-nums">{fmtMoney(checkout.amountPaise, checkout.currency)}</p>
            <p className="mt-2 text-xs text-faint">
              Payer: {checkout.prefill.name} · {checkout.prefill.email}
              <br />
              Order: {checkout.orderId}
            </p>
          </div>
          <ErrorBox error={fakePay.error} />
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => setStep("form")}>
              Cancel
            </Button>
            <Button variant="danger" loading={fakePay.isPending && fakePay.variables === "failure"} onClick={() => fakePay.mutate("failure")}>
              Simulate a decline
            </Button>
            <Button loading={fakePay.isPending && fakePay.variables === "success"} onClick={() => fakePay.mutate("success")}>
              <CreditCard className="size-4" /> Pay {fmtMoney(checkout.amountPaise, checkout.currency)}
            </Button>
          </div>
        </div>
      ) : step === "verifying" ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted">
          <Spinner /> Confirming the payment with the server…
        </div>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            convert.mutate();
          }}
        >
          {step === "declined" && (
            <div className="rounded-md border border-bad/30 bg-bad-soft px-3 py-2 text-sm text-bad">The payment was declined. Nothing was charged; you can try again.</div>
          )}
          <p className="text-sm text-muted">This creates a student account for {lead.email}, puts them in the batch, and locks the lead.</p>
          <Field label="Batch" error={fe.batchId}>
            {batches.isPending ? (
              <Spinner />
            ) : (
              <Select
                required
                value={batchId}
                onChange={(e) => {
                  setBatchId(e.target.value);
                  setCheckout(null); // a different batch needs a new order
                  setStep("form");
                }}
              >
                <option value="">Choose a batch</option>
                {batches.data?.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} · {b.course}
                    {b.feePaise ? ` · ${fmtMoney(b.feePaise)}` : ""}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {canCollect && (
            <div className="flex items-center justify-between rounded-md border border-brand/30 bg-brand-soft px-3 py-2 text-sm">
              <span className="text-muted">Course fee</span>
              <span className="text-base font-semibold tabular-nums text-brand-strong">{fmtMoney(fee)}</span>
            </div>
          )}
          <TextField
            label="First password (optional)"
            type="text"
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={fe.password}
            hint={canCollect ? "Only for enrolling without payment. After a payment, a generated password is emailed." : "Leave empty to email them a generated one."}
          />
          {notice && <p className="text-sm text-warn">{notice}</p>}
          {Object.keys(fe).length === 0 && <ErrorBox error={convert.error ?? order.error ?? verify.error} />}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" onClick={close}>
              Cancel
            </Button>
            {canCollect ? (
              <>
                <Button type="submit" variant="secondary" disabled={!batchId} loading={convert.isPending}>
                  Enroll without payment
                </Button>
                <Button type="button" disabled={!batchId} loading={order.isPending} onClick={collect}>
                  <CreditCard className="size-4" /> Collect {fmtMoney(fee)} &amp; enroll
                </Button>
              </>
            ) : (
              <Button type="submit" disabled={!batchId} loading={convert.isPending}>
                Enroll
              </Button>
            )}
          </div>
        </form>
      )}
    </Modal>
  );
}

function TemporaryPasswordNote({ password, email, chosen }: { password?: string; email: string; chosen: boolean }) {
  return password ? (
    <div className="rounded-md border border-warn/30 bg-warn-soft p-3">
      The welcome email couldn't be queued, so share this temporary password yourself. It won't be shown again:
      <code className="mt-2 block text-base font-semibold">{password}</code>
    </div>
  ) : (
    <p className="text-muted">A welcome email {chosen ? "is on its way" : "with a temporary password is on its way"} to {email}.</p>
  );
}

function PaidSummary({ result, lead, onClose }: { result: VerifyResult; lead: Lead; onClose: () => void }) {
  const { payment, enrollment } = result;
  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center gap-3 rounded-lg border border-good/30 bg-good-soft p-3">
        <CheckCircle2 className="size-6 shrink-0 text-good" />
        <div>
          <p className="font-semibold text-good">Payment received: {fmtMoney(payment.amountPaise, payment.currency)}</p>
          <p className="text-xs text-muted">
            {payment.gatewayPaymentId} · a receipt is on its way to {lead.email}
          </p>
        </div>
      </div>
      {enrollment?.status === "ENROLLED" ? (
        <>
          <p>
            <b>{lead.name}</b> now has a student account and is in {payment.batch.name}.
          </p>
          <TemporaryPasswordNote password={enrollment.temporaryPassword} email={lead.email} chosen={false} />
        </>
      ) : enrollment?.status === "NOT_ENROLLED" ? (
        <div className="rounded-md border border-warn/30 bg-warn-soft p-3 text-warn">
          The payment is recorded, but enrolment didn't happen: {enrollment.reason}
        </div>
      ) : (
        <p className="text-muted">This payment had already been recorded.</p>
      )}
      <div className="flex justify-end">
        <Button onClick={onClose}>Done</Button>
      </div>
    </div>
  );
}

const paymentTone = (s: Payment["status"]) => (s === "PAID" ? "good" : s === "FAILED" ? "bad" : "neutral");

function Payments({ leadId }: { leadId: string }) {
  const config = usePaymentConfig();
  const payments = useQuery({
    queryKey: ["payments", leadId],
    queryFn: () => api.get<{ items: Payment[] }>(`/payments?leadId=${leadId}`).then((r) => r.items),
    enabled: !!config.data?.enabled,
  });
  if (!config.data?.enabled) return null;
  return (
    <Card title="Payments">
      <QueryState query={payments}>
        {(items) =>
          items.length === 0 ? (
            <p className="text-sm text-muted">No payments yet. Fees are collected from “Enroll as student”.</p>
          ) : (
            <ul className="space-y-3">
              {items.map((p) => (
                <li key={p.id} className="rounded-md border border-line p-3 text-sm transition-colors hover:border-brand/30">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold tabular-nums">{fmtMoney(p.amountPaise, p.currency)}</span>
                    <Badge tone={paymentTone(p.status)}>{p.status === "CREATED" ? "Not paid" : titleCase(p.status)}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {p.batch.course} · {p.batch.name}
                  </p>
                  <p className="text-xs text-faint">
                    {p.paidAt ? `Paid ${fmtDateTime(p.paidAt)}` : `Started ${fmtDateTime(p.createdAt)}`} by {p.createdBy.name}
                    {p.provider === "fake" && " · test gateway"}
                  </p>
                  {p.gatewayPaymentId && <p className="mt-1 truncate font-mono text-xs text-faint">{p.gatewayPaymentId}</p>}
                  {p.failureReason && p.status === "FAILED" && <p className="mt-1 text-xs text-bad">{p.failureReason}</p>}
                  {p.enrollmentError && <p className="mt-1 text-xs text-warn">Not enrolled: {p.enrollmentError}</p>}
                </li>
              ))}
            </ul>
          )
        }
      </QueryState>
    </Card>
  );
}
