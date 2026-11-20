import { useState } from "react";
import { Link, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarPlus, Download, FileCheck, Lock, LockOpen, Pencil, Plus } from "lucide-react";
import { api, downloadFile } from "../../lib/api";
import { fmtDate, fmtDateTime, fmtPct, fmtSeconds } from "../../lib/format";
import type { Applicant, ApplicationStatus, InterviewMode, InterviewOutcome, ManagedJob } from "../../lib/types";
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Modal, PageHeader, QueryState, Select, Table, Td, TextField, Textarea, Th, Tabs, cx, fieldErrorsOf } from "../../components/ui";
import { AppStatusBadge, JobFacts, JobFormModal, PIPELINE, appStatusInfo, modeLabel, outcomeInfo, toLocalInput } from "../../components/Jobs";
import { BandBadge, ReadinessMeter } from "../../components/Readiness";
import { fmtScore } from "../../components/Quiz";

type Filter = "ALL" | ApplicationStatus;

export function JobDetailPage() {
  const { id } = useParams() as { id: string };
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const job = useQuery({ queryKey: ["job", id], queryFn: () => api.get<{ job: ManagedJob }>(`/jobs/${id}`).then((r) => r.job) });
  const toggle = useMutation({
    mutationFn: (status: "OPEN" | "CLOSED") => api.patch(`/jobs/${id}`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["job", id] });
      qc.invalidateQueries({ queryKey: ["jobs"] });
    },
  });

  return (
    <>
      <Link to="/jobs" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Jobs
      </Link>
      <QueryState query={job}>
        {(j) => (
          <>
            <PageHeader
              title={
                <span className="flex flex-wrap items-center gap-2">
                  {j.title}
                  <Badge tone={j.status === "OPEN" ? "good" : "neutral"}>{j.status === "OPEN" ? "Open" : "Closed"}</Badge>
                  {j.isCampusDrive && <Badge tone="brand">Campus drive</Badge>}
                </span>
              }
              subtitle={<JobFacts job={j} />}
              actions={
                <>
                  <Button variant="secondary" onClick={() => setEditing(true)}>
                    <Pencil className="size-4" /> Edit
                  </Button>
                  <Button variant="secondary" loading={toggle.isPending} onClick={() => toggle.mutate(j.status === "OPEN" ? "CLOSED" : "OPEN")}>
                    {j.status === "OPEN" ? <Lock className="size-4" /> : <LockOpen className="size-4" />} {j.status === "OPEN" ? "Close" : "Reopen"}
                  </Button>
                </>
              }
            />
            <ErrorBox error={toggle.error} />
            <div className="mb-4 grid gap-4 lg:grid-cols-[1fr_340px]">
              <Card title="About the role">
                <p className="whitespace-pre-line text-sm">{j.description}</p>
                {j.skills.length > 0 && (
                  <p className="mt-3 flex flex-wrap gap-1">
                    {j.skills.map((s) => (
                      <Badge key={s} tone="brand">
                        {s}
                      </Badge>
                    ))}
                  </p>
                )}
                {j.minReadiness != null && <p className="mt-2 text-xs text-muted">Students need {j.minReadiness}% placement readiness to apply.</p>}
              </Card>
              <Card
                title="Hiring tests"
                actions={
                  <Link to={`/quizzes/new?jobId=${j.id}`}>
                    <Button size="sm" variant="secondary">
                      <Plus className="size-4" /> New test
                    </Button>
                  </Link>
                }
              >
                {j.tests.length === 0 ? (
                  <p className="text-sm text-muted">A timed test only your applicants can take. Set when it opens and closes so everyone sits it together.</p>
                ) : (
                  <ul className="space-y-2">
                    {j.tests.map((t) => (
                      <li key={t.id} className="text-sm">
                        <div className="flex items-start justify-between gap-2">
                          <Link to={`/quizzes/${t.id}`} className="font-medium text-brand-strong hover:underline">
                            {t.title}
                          </Link>
                          {t.isPublished ? <Badge tone="good">Live</Badge> : <Badge>Draft</Badge>}
                        </div>
                        <p className="text-xs text-muted">
                          {fmtSeconds(t.durationSeconds)}
                          {t.opensAt && ` · opens ${fmtDateTime(t.opensAt)}`}
                          {t.closesAt && ` · closes ${fmtDateTime(t.closesAt)}`}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
            <Applicants job={j} />
            {editing && <JobFormModal open job={j} onClose={() => setEditing(false)} />}
          </>
        )}
      </QueryState>
    </>
  );
}

function Applicants({ job }: { job: ManagedJob }) {
  const [filter, setFilter] = useState<Filter>("ALL");
  const [scheduling, setScheduling] = useState<Applicant | null>(null);
  const list = useQuery({ queryKey: ["applicants", job.id], queryFn: () => api.get<{ items: Applicant[] }>(`/jobs/${job.id}/applicants`).then((r) => r.items) });
  const testTitle = new Map(job.tests.map((t) => [t.id, t.title]));

  return (
    <QueryState query={list}>
      {(items) => {
        const count = (s: ApplicationStatus) => items.filter((a) => a.status === s).length;
        const rows = filter === "ALL" ? items.filter((a) => a.status !== "WITHDRAWN") : items.filter((a) => a.status === filter);
        return (
          <>
            <Tabs<Filter>
              value={filter}
              onChange={setFilter}
              tabs={[
                { id: "ALL", label: `All (${items.filter((a) => a.status !== "WITHDRAWN").length})` },
                ...PIPELINE.map((s) => ({ id: s as Filter, label: `${appStatusInfo[s].label} (${count(s)})` })),
                ...(count("WITHDRAWN") ? [{ id: "WITHDRAWN" as Filter, label: `Withdrawn (${count("WITHDRAWN")})` }] : []),
              ]}
            />
            <Card padded={false}>
              {rows.length === 0 ? (
                <EmptyState title={items.length ? "No one at this stage" : "No applicants yet"}>{items.length ? undefined : "Students who apply show up here, with their readiness and resume."}</EmptyState>
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <Th>Applicant</Th>
                      <Th>Readiness</Th>
                      <Th>Tests</Th>
                      <Th>Interviews</Th>
                      <Th>Stage</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((a) => (
                      <ApplicantRow key={a.id} a={a} jobId={job.id} testTitle={testTitle} onSchedule={() => setScheduling(a)} />
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>
            {scheduling && <ScheduleModal applicant={scheduling} jobId={job.id} onClose={() => setScheduling(null)} />}
          </>
        );
      }}
    </QueryState>
  );
}

function ApplicantRow({ a, jobId, testTitle, onSchedule }: { a: Applicant; jobId: string; testTitle: Map<string, string>; onSchedule: () => void }) {
  const qc = useQueryClient();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["applicants", jobId] });
    qc.invalidateQueries({ queryKey: ["jobs"] });
  };
  const status = useMutation({ mutationFn: (s: ApplicationStatus) => api.patch(`/jobs/applications/${a.id}`, { status: s }), onSuccess: refresh });
  const outcome = useMutation({ mutationFn: (v: { id: string; outcome: InterviewOutcome }) => api.patch(`/jobs/interviews/${v.id}`, { outcome: v.outcome }), onSuccess: refresh });
  const resume = useMutation({ mutationFn: () => downloadFile(`/documents/${a.resume!.id}/download`, a.resume!.originalName) });
  const closed = a.status === "WITHDRAWN";

  return (
    <tr className="align-top">
      <Td>
        <div className="font-medium">{a.student.name}</div>
        <div className="text-xs text-muted">{a.student.email}</div>
        <div className="text-xs text-faint">
          {a.student.batch ? `${a.student.batch.name} · ` : ""}applied {fmtDate(a.appliedAt)}
        </div>
        {a.coverNote && <p className="mt-1 max-w-xs whitespace-pre-line text-xs text-ink">“{a.coverNote}”</p>}
        {a.resume ? (
          <button type="button" onClick={() => resume.mutate()} className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-brand-strong hover:underline">
            <Download className="size-3.5" /> Resume
          </button>
        ) : (
          <span className="mt-1 block text-xs text-faint">No resume uploaded</span>
        )}
        <ErrorBox error={resume.error} />
      </Td>
      <Td>
        <div className="flex items-center gap-2">
          <ReadinessMeter value={a.readiness} band={a.band} />
          <BandBadge band={a.band} />
        </div>
        {a.strengths.length > 0 && <p className="mt-1 max-w-[220px] text-xs text-good">Strong: {a.strengths.slice(0, 3).join(", ")}</p>}
        {a.gaps.length > 0 && <p className="max-w-[220px] text-xs text-bad">Gaps: {a.gaps.slice(0, 3).join(", ")}</p>}
      </Td>
      <Td>
        {a.tests.length === 0 ? (
          <span className="text-faint">—</span>
        ) : (
          <ul className="space-y-0.5 text-xs">
            {a.tests.map((t) => (
              <li key={t.quizId} className="whitespace-nowrap">
                <span className="text-muted">{testTitle.get(t.quizId) ?? "Test"}:</span>{" "}
                {t.status === "SUBMITTED" ? (
                  <span className="font-semibold tabular-nums">
                    {fmtScore(t.score)}/{t.maxScore} ({fmtPct(t.maxScore ? (t.score / t.maxScore) * 100 : 0)})
                  </span>
                ) : (
                  <Badge tone={t.status === "EXPIRED" ? "bad" : "warn"}>{t.status === "EXPIRED" ? "Time ran out" : "In progress"}</Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </Td>
      <Td>
        <ul className="space-y-1.5 text-xs">
          {a.interviews.map((iv) => (
            <li key={iv.id}>
              <div className="whitespace-nowrap font-medium">{fmtDateTime(iv.scheduledAt)}</div>
              <div className="text-muted">
                {modeLabel[iv.mode]} · {iv.durationMinutes} min
              </div>
              <select
                value={iv.outcome}
                onChange={(e) => outcome.mutate({ id: iv.id, outcome: e.target.value as InterviewOutcome })}
                className="mt-0.5 h-7 rounded border border-line bg-surface px-1 text-xs"
                aria-label="Interview outcome"
              >
                {(Object.keys(outcomeInfo) as InterviewOutcome[]).map((o) => (
                  <option key={o} value={o}>
                    {outcomeInfo[o].label}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
        {!closed && !["REJECTED", "HIRED"].includes(a.status) && (
          <Button size="sm" variant="ghost" className="mt-1" onClick={onSchedule}>
            <CalendarPlus className="size-4" /> Schedule
          </Button>
        )}
      </Td>
      <Td>
        {closed ? (
          <AppStatusBadge status={a.status} />
        ) : (
          <select
            value={a.status}
            onChange={(e) => status.mutate(e.target.value as ApplicationStatus)}
            className={cx("h-8 rounded-md border border-line bg-surface px-2 text-sm", status.isPending && "opacity-60")}
            aria-label={`Stage for ${a.student.name}`}
            disabled={status.isPending}
          >
            {PIPELINE.map((s) => (
              <option key={s} value={s}>
                {appStatusInfo[s].label}
              </option>
            ))}
          </select>
        )}
        {a.status === "HIRED" && <FileCheck className="ml-1 inline size-4 text-good" aria-label="Hired" />}
        <ErrorBox error={status.error ?? outcome.error} />
      </Td>
    </tr>
  );
}

function ScheduleModal({ applicant, jobId, onClose }: { applicant: Applicant; jobId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const tomorrow = new Date(Date.now() + 86_400_000);
  tomorrow.setMinutes(0, 0, 0);
  const [f, setF] = useState({ at: toLocalInput(tomorrow.toISOString()), duration: "30", mode: "ONLINE" as InterviewMode, location: "", notes: "" });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = useMutation({
    mutationFn: () =>
      api.post(`/jobs/applications/${applicant.id}/interviews`, {
        scheduledAt: new Date(f.at).toISOString(),
        durationMinutes: Number(f.duration),
        mode: f.mode,
        location: f.location || null,
        notes: f.notes || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["applicants", jobId] });
      qc.invalidateQueries({ queryKey: ["jobs"] });
      onClose();
    },
  });
  const errors = fieldErrorsOf(save.error);
  return (
    <Modal open onClose={onClose} title={`Interview with ${applicant.student.name}`}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
          <TextField label="When" type="datetime-local" required min={toLocalInput(new Date().toISOString())} value={f.at} onChange={set("at")} error={errors.scheduledAt} />
          <TextField label="Minutes" type="number" min={10} max={480} value={f.duration} onChange={set("duration")} />
        </div>
        <div className="grid gap-3 sm:grid-cols-[150px_1fr]">
          <Field label="How">
            <Select value={f.mode} onChange={set("mode")}>
              {(Object.keys(modeLabel) as InterviewMode[]).map((m) => (
                <option key={m} value={m}>
                  {modeLabel[m]}
                </option>
              ))}
            </Select>
          </Field>
          <TextField
            label={f.mode === "ONLINE" ? "Meeting link" : f.mode === "IN_PERSON" ? "Address" : "Number to call (optional)"}
            placeholder={f.mode === "ONLINE" ? "https://meet.google.com/…" : undefined}
            maxLength={500}
            value={f.location}
            onChange={set("location")}
            error={errors.location}
          />
        </div>
        <Field label="Notes for the student (optional)">
          <Textarea rows={3} maxLength={3000} value={f.notes} onChange={set("notes")} placeholder="Who they'll meet, what to prepare" />
        </Field>
        <p className="text-xs text-muted">The student gets an email with these details, and the application moves to Interview.</p>
        <ErrorBox error={save.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending}>
            Schedule
          </Button>
        </div>
      </form>
    </Modal>
  );
}
