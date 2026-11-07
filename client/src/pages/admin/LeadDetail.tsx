import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, GraduationCap, Trash2 } from "lucide-react";
import { api } from "../../lib/api";
import { fmtDateTime, relative, titleCase } from "../../lib/format";
import { STAGES, type Batch, type Lead, type LeadActivity, type LeadNote, type LeadStage, type Paginated } from "../../lib/types";
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Modal, PageHeader, QueryState, Select, Spinner, TextField, Textarea, fieldErrorsOf, stageTone } from "../../components/ui";
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
                onClick={() => confirm(`Delete ${lead.name}? Their notes and timeline are deleted too.`) && remove.mutate()}
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

function ConvertModal({ lead, open, onClose, onDone }: { lead: Lead; open: boolean; onClose: () => void; onDone: () => void }) {
  const batches = useQuery({ queryKey: ["batches"], queryFn: () => api.get<{ items: Batch[] }>("/batches").then((r) => r.items), enabled: open });
  const [batchId, setBatchId] = useState("");
  const [password, setPassword] = useState("");
  const convert = useMutation({
    mutationFn: () =>
      api.post<{ welcomeEmail: { status: string }; temporaryPassword?: string }>(`/leads/${lead.id}/convert`, { batchId, ...(password && { password }) }),
    onSuccess: onDone,
  });
  const fe = fieldErrorsOf(convert.error);
  const close = () => {
    convert.reset();
    setPassword("");
    onClose();
  };

  return (
    <Modal open={open} onClose={close} title={`Enroll ${lead.name}`}>
      {convert.data ? (
        <div className="space-y-3 text-sm">
          <p>
            <b>{lead.name}</b> now has a student account and is in the batch.
          </p>
          {convert.data.temporaryPassword ? (
            <div className="rounded-md border border-warn/30 bg-warn-soft p-3">
              The welcome email couldn't be queued, so share this temporary password yourself. It won't be shown again:
              <code className="mt-2 block text-base font-semibold">{convert.data.temporaryPassword}</code>
            </div>
          ) : (
            <p className="text-muted">A welcome email {password ? "is on its way" : "with a temporary password is on its way"} to {lead.email}.</p>
          )}
          <div className="flex justify-end">
            <Button onClick={close}>Done</Button>
          </div>
        </div>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            convert.mutate();
          }}
        >
          <p className="text-sm text-muted">This creates a student account for {lead.email}, puts them in the batch, and locks the lead.</p>
          <Field label="Batch" error={fe.batchId}>
            {batches.isPending ? (
              <Spinner />
            ) : (
              <Select required value={batchId} onChange={(e) => setBatchId(e.target.value)}>
                <option value="">Choose a batch</option>
                {batches.data?.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} · {b.course}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <TextField label="First password (optional)" type="text" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} error={fe.password} hint="Leave empty to email them a generated one." />
          {Object.keys(fe).length === 0 && <ErrorBox error={convert.error} />}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={!batchId} loading={convert.isPending}>
              Enroll
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
