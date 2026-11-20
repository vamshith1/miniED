import { useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, ExternalLink, Eye, EyeOff, Send, Timer } from "lucide-react";
import { api } from "../../lib/api";
import { useAuth, useUser } from "../../lib/auth";
import { fmtDateTime, fmtSeconds } from "../../lib/format";
import type { MyApplication, StudentJob, StudentJobDetail, User } from "../../lib/types";
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Modal, PageHeader, QueryState, Tabs, Textarea, askConfirm } from "../../components/ui";
import { AppStatusBadge, JobFacts, modeLabel, outcomeInfo } from "../../components/Jobs";

type Tab = "jobs" | "applications";

/** Students: jobs and campus drives to apply to, and where each application stands. */
export function CareersPage() {
  const [tab, setTab] = useState<Tab>("jobs");
  const [open, setOpen] = useState<StudentJob | null>(null);
  const jobs = useQuery({ queryKey: ["jobs", "student"], queryFn: () => api.get<{ items: StudentJob[] }>("/jobs").then((r) => r.items) });
  const apps = useQuery({ queryKey: ["applications", "mine"], queryFn: () => api.get<{ items: MyApplication[] }>("/jobs/applications/mine").then((r) => r.items) });
  const active = apps.data?.filter((a) => a.status !== "WITHDRAWN").length;

  return (
    <>
      <PageHeader title="Careers" subtitle="Jobs and campus drives from recruiters. Your placement readiness and resume go with every application." />
      <ShareToggle />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "jobs", label: `Open jobs${jobs.data ? ` (${jobs.data.filter((j) => j.status === "OPEN").length})` : ""}` },
          { id: "applications", label: `My applications${active != null ? ` (${active})` : ""}` },
        ]}
      />
      {tab === "jobs" && (
        <QueryState query={jobs}>
          {(items) =>
            items.length === 0 ? (
              <Card>
                <EmptyState title="No jobs right now">When recruiters post jobs or the institute runs a campus drive, they show up here.</EmptyState>
              </Card>
            ) : (
              <ul className="space-y-3">
                {items.map((j) => (
                  <li key={j.id}>
                    <Card
                      title={
                        <span className="flex flex-wrap items-center gap-2">
                          {j.title} {j.isCampusDrive && <Badge tone="brand">Campus drive</Badge>}
                        </span>
                      }
                      actions={j.myApplication ? <AppStatusBadge status={j.myApplication.status} /> : undefined}
                    >
                      <JobFacts job={j} />
                      <p className="mt-2 line-clamp-3 whitespace-pre-line text-sm">{j.description}</p>
                      {j.skills.length > 0 && (
                        <p className="mt-2 flex flex-wrap gap-1">
                          {j.skills.map((s) => (
                            <Badge key={s}>{s}</Badge>
                          ))}
                        </p>
                      )}
                      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                        {!j.canApply && !j.myApplication && <span className="text-xs text-muted">{j.cannotApplyReason}</span>}
                        <Button size="sm" variant={j.myApplication || !j.canApply ? "secondary" : "primary"} onClick={() => setOpen(j)}>
                          {j.myApplication && j.myApplication.status !== "WITHDRAWN" ? "View" : j.canApply ? "View & apply" : "View"}
                        </Button>
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>
            )
          }
        </QueryState>
      )}
      {tab === "applications" && (
        <QueryState query={apps}>
          {(items) =>
            items.length === 0 ? (
              <Card>
                <EmptyState title="No applications yet">Apply to a job and follow its progress here.</EmptyState>
              </Card>
            ) : (
              <ul className="space-y-3">
                {items.map((a) => (
                  <li key={a.id}>
                    <Card title={`${a.job.title} · ${a.job.company}`} actions={<AppStatusBadge status={a.status} />}>
                      <p className="text-xs text-muted">Applied {fmtDateTime(a.createdAt)} · last update {fmtDateTime(a.updatedAt)}</p>
                      {a.interviews.length > 0 && <InterviewList interviews={a.interviews} />}
                      <div className="mt-2 flex justify-end">
                        <Button size="sm" variant="ghost" onClick={() => setOpen({ id: a.job.id } as StudentJob)}>
                          Details
                        </Button>
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>
            )
          }
        </QueryState>
      )}
      {open && <JobModal jobId={open.id} onClose={() => setOpen(null)} />}
    </>
  );
}

function ShareToggle() {
  const user = useUser();
  const { replaceSession } = useAuth();
  const qc = useQueryClient();
  const toggle = useMutation({
    mutationFn: async () => {
      await api.put("/jobs/profile-sharing", { share: !user.shareProfile });
      return api.get<{ user: User }>("/auth/me");
    },
    onSuccess: (r) => {
      replaceSession(r);
      qc.invalidateQueries({ queryKey: ["jobs"] });
    },
  });
  const on = user.shareProfile;
  return (
    <Card className="mb-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          {on ? <Eye className="mt-0.5 size-5 text-good" /> : <EyeOff className="mt-0.5 size-5 text-muted" />}
          <div>
            <p className="font-medium">{on ? "Recruiters can find you" : "Your profile is private"}</p>
            <p className="text-sm text-muted">
              {on
                ? "Your name, email, batch, placement readiness, skills and resume are in the talent pool recruiters browse."
                : "Turn this on to appear in the talent pool, so recruiters can find you even before you apply. Jobs you apply to always see your profile."}
            </p>
          </div>
        </div>
        <Button variant={on ? "secondary" : "primary"} loading={toggle.isPending} onClick={() => toggle.mutate()}>
          {on ? "Stop sharing" : "Share my profile"}
        </Button>
      </div>
      <ErrorBox error={toggle.error} />
    </Card>
  );
}

function InterviewList({ interviews }: { interviews: MyApplication["interviews"] }) {
  return (
    <ul className="mt-3 space-y-2">
      {interviews.map((iv) => (
        <li key={iv.id} className="rounded-md bg-canvas px-3 py-2 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 font-medium">
              <CalendarClock className="size-4 text-brand-strong" /> Interview {fmtDateTime(iv.scheduledAt)}
            </span>
            <Badge tone={outcomeInfo[iv.outcome].tone}>{outcomeInfo[iv.outcome].label}</Badge>
          </div>
          <p className="text-xs text-muted">
            {modeLabel[iv.mode]} · {iv.durationMinutes} min
          </p>
          {iv.location &&
            (/^https?:\/\//i.test(iv.location) ? (
              <a href={iv.location} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 break-all text-xs font-medium text-brand-strong hover:underline">
                <ExternalLink className="size-3.5" /> {iv.location}
              </a>
            ) : (
              <p className="text-xs">{iv.location}</p>
            ))}
          {iv.notes && <p className="mt-1 whitespace-pre-line text-xs">{iv.notes}</p>}
        </li>
      ))}
    </ul>
  );
}

function JobModal({ jobId, onClose }: { jobId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const job = useQuery({ queryKey: ["job", jobId, "student"], queryFn: () => api.get<{ job: StudentJobDetail }>(`/jobs/${jobId}`).then((r) => r.job) });
  const list = qc.getQueryData<StudentJob[]>(["jobs", "student"])?.find((j) => j.id === jobId);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["jobs", "student"] });
    qc.invalidateQueries({ queryKey: ["applications", "mine"] });
    qc.invalidateQueries({ queryKey: ["job", jobId, "student"] });
  };
  const apply = useMutation({ mutationFn: () => api.post(`/jobs/${jobId}/apply`, { coverNote: note || null }), onSuccess: refresh });
  const withdraw = useMutation({ mutationFn: () => api.post(`/jobs/${jobId}/withdraw`), onSuccess: refresh });

  return (
    <Modal open onClose={onClose} title={job.data?.title ?? "Job"} wide>
      <QueryState query={job}>
        {(j) => {
          const app = j.myApplication;
          const applied = app && app.status !== "WITHDRAWN";
          const canApply = list ? list.canApply : j.status === "OPEN";
          return (
            <div className="space-y-3">
              <JobFacts job={j} />
              <p className="whitespace-pre-line text-sm">{j.description}</p>
              {j.skills.length > 0 && (
                <p className="flex flex-wrap gap-1">
                  {j.skills.map((s) => (
                    <Badge key={s}>{s}</Badge>
                  ))}
                </p>
              )}
              {j.minReadiness != null && <p className="text-xs text-muted">Needs {j.minReadiness}% placement readiness.</p>}

              {applied ? (
                <div className="space-y-3 rounded-lg border border-line p-3">
                  <p className="flex items-center gap-2 text-sm">
                    Your application: <AppStatusBadge status={app.status} />
                  </p>
                  {j.tests.length > 0 && (
                    <div>
                      <p className="mb-1 text-sm font-medium">Hiring tests</p>
                      <ul className="space-y-1.5">
                        {j.tests.map((t) => {
                          const notYet = t.opensAt && new Date(t.opensAt) > new Date();
                          const over = t.closesAt && new Date(t.closesAt) < new Date();
                          return (
                            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                              <span className="flex items-center gap-1.5">
                                <Timer className="size-4 text-muted" /> {t.title} · {fmtSeconds(t.durationSeconds)}
                                {notYet && <span className="text-xs text-muted">· opens {fmtDateTime(t.opensAt)}</span>}
                                {t.closesAt && !over && <span className="text-xs text-muted">· closes {fmtDateTime(t.closesAt)}</span>}
                              </span>
                              {over ? (
                                <Link to={`/quizzes/${t.id}/result`} className="text-sm font-medium text-brand-strong hover:underline">
                                  Result
                                </Link>
                              ) : (
                                <Link to={`/quizzes/${t.id}/take`} aria-disabled={!!notYet} className={notYet ? "pointer-events-none opacity-50" : undefined}>
                                  <Button size="sm">Take test</Button>
                                </Link>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                  {app.interviews.length > 0 && <InterviewList interviews={app.interviews} />}
                  {app.status !== "HIRED" && (
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        variant="danger"
                        loading={withdraw.isPending}
                        onClick={async () => (await askConfirm("Withdraw this application? You can apply again while the job is open.", { confirmLabel: "Withdraw", danger: true })) && withdraw.mutate()}
                      >
                        Withdraw
                      </Button>
                    </div>
                  )}
                </div>
              ) : canApply ? (
                <form
                  className="space-y-2 rounded-lg border border-line p-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    apply.mutate();
                  }}
                >
                  <Field label="Why you'd be a good fit (optional)">
                    <Textarea rows={3} maxLength={3000} value={note} onChange={(e) => setNote(e.target.value)} />
                  </Field>
                  <p className="text-xs text-muted">The recruiter sees your name, email, batch, placement readiness, skills and your resume (upload it under My resume).</p>
                  <div className="flex justify-end">
                    <Button type="submit" loading={apply.isPending}>
                      <Send className="size-4" /> Apply
                    </Button>
                  </div>
                </form>
              ) : (
                <p className="rounded-lg bg-canvas px-3 py-2 text-sm text-muted">{list?.cannotApplyReason ?? "Applications are closed."}</p>
              )}
              <ErrorBox error={apply.error ?? withdraw.error} />
            </div>
          );
        }}
      </QueryState>
    </Modal>
  );
}
