import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Briefcase, Building2, CalendarClock, IndianRupee, MapPin, Users } from "lucide-react";
import { api } from "../lib/api";
import { fmtDate } from "../lib/format";
import type { ApplicationStatus, InterviewMode, InterviewOutcome, JobBase, JobType, ManagedJob } from "../lib/types";
import { Badge, Button, ErrorBox, Field, Modal, Select, TextField, Textarea, cx, fieldErrorsOf } from "./ui";

export const jobTypeLabel: Record<JobType, string> = { FULL_TIME: "Full time", INTERNSHIP: "Internship", CONTRACT: "Contract" };

export const appStatusInfo: Record<ApplicationStatus, { label: string; tone: "neutral" | "brand" | "good" | "warn" | "bad" }> = {
  APPLIED: { label: "Applied", tone: "neutral" },
  SHORTLISTED: { label: "Shortlisted", tone: "brand" },
  INTERVIEW: { label: "Interview", tone: "warn" },
  OFFERED: { label: "Offered", tone: "good" },
  HIRED: { label: "Hired", tone: "good" },
  REJECTED: { label: "Not selected", tone: "bad" },
  WITHDRAWN: { label: "Withdrawn", tone: "neutral" },
};

export const PIPELINE: ApplicationStatus[] = ["APPLIED", "SHORTLISTED", "INTERVIEW", "OFFERED", "HIRED", "REJECTED"];

export const modeLabel: Record<InterviewMode, string> = { ONLINE: "Online", IN_PERSON: "In person", PHONE: "Phone" };
export const outcomeInfo: Record<InterviewOutcome, { label: string; tone: "neutral" | "good" | "bad" | "warn" }> = {
  PENDING: { label: "Upcoming", tone: "warn" },
  PASSED: { label: "Passed", tone: "good" },
  FAILED: { label: "Not passed", tone: "bad" },
  NO_SHOW: { label: "No show", tone: "bad" },
};

export function AppStatusBadge({ status }: { status: ApplicationStatus }) {
  const i = appStatusInfo[status];
  return <Badge tone={i.tone}>{i.label}</Badge>;
}

/** Company, place, type, pay, deadline: one line of facts about a job. */
export function JobFacts({ job, className }: { job: JobBase; className?: string }) {
  const past = job.deadline && new Date(job.deadline) < new Date();
  return (
    <div className={cx("flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted", className)}>
      <span className="flex items-center gap-1">
        <Building2 className="size-3.5" /> {job.company}
      </span>
      {job.location && (
        <span className="flex items-center gap-1">
          <MapPin className="size-3.5" /> {job.location}
        </span>
      )}
      <span className="flex items-center gap-1">
        <Briefcase className="size-3.5" /> {jobTypeLabel[job.type]}
      </span>
      {job.salary && (
        <span className="flex items-center gap-1">
          <IndianRupee className="size-3.5" /> {job.salary}
        </span>
      )}
      {job.deadline && (
        <span className={cx("flex items-center gap-1", past && "text-bad")}>
          <CalendarClock className="size-3.5" /> {past ? "Closed" : "Apply by"} {fmtDate(job.deadline)}
        </span>
      )}
      {job.isCampusDrive && (
        <span className="flex items-center gap-1">
          <Users className="size-3.5" /> Campus drive: {job.batches.map((b) => b.name).join(", ")}
        </span>
      )}
    </div>
  );
}

// "2026-11-20T18:30" for a datetime-local input, in the viewer's own time zone.
export const toLocalInput = (iso: string | null | undefined) => {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

/** Create a job (no `job`) or edit one. */
export function JobFormModal({ open, onClose, job, onSaved }: { open: boolean; onClose: () => void; job?: ManagedJob; onSaved?: (j: ManagedJob) => void }) {
  const qc = useQueryClient();
  const batches = useQuery({ queryKey: ["jobs", "batch-options"], queryFn: () => api.get<{ items: { id: string; name: string; course: string }[] }>("/jobs/batch-options").then((r) => r.items), enabled: open });
  const [f, setF] = useState(() => ({
    title: job?.title ?? "",
    company: job?.company ?? "",
    location: job?.location ?? "",
    type: job?.type ?? ("FULL_TIME" as JobType),
    salary: job?.salary ?? "",
    description: job?.description ?? "",
    skills: job?.skills.join(", ") ?? "",
    minReadiness: job?.minReadiness?.toString() ?? "",
    deadline: toLocalInput(job?.deadline),
    batchIds: job?.batches.map((b) => b.id) ?? ([] as string[]),
  }));
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = useMutation({
    mutationFn: () => {
      const body = {
        title: f.title,
        ...(f.company.trim() && { company: f.company.trim() }),
        location: f.location || null,
        type: f.type,
        salary: f.salary || null,
        description: f.description,
        skills: f.skills.split(",").map((s) => s.trim()).filter(Boolean),
        minReadiness: f.minReadiness ? Number(f.minReadiness) : null,
        deadline: f.deadline ? new Date(f.deadline).toISOString() : null,
        batchIds: f.batchIds,
      };
      return job ? api.patch<{ job: ManagedJob }>(`/jobs/${job.id}`, body) : api.post<{ job: ManagedJob }>("/jobs", body);
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["job", r.job.id] });
      onSaved?.(r.job);
      onClose();
    },
  });
  const errors = fieldErrorsOf(save.error);
  return (
    <Modal open={open} onClose={onClose} title={job ? "Edit job" : "Post a job"} wide>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Job title" required minLength={2} maxLength={200} value={f.title} onChange={set("title")} error={errors.title} />
          <TextField label="Company" hint="Leave empty to use your account's company" maxLength={120} value={f.company} onChange={set("company")} error={errors.company} />
          <TextField label="Location" placeholder="Bengaluru / Remote" maxLength={120} value={f.location} onChange={set("location")} />
          <Field label="Type">
            <Select value={f.type} onChange={set("type")}>
              {(Object.keys(jobTypeLabel) as JobType[]).map((t) => (
                <option key={t} value={t}>
                  {jobTypeLabel[t]}
                </option>
              ))}
            </Select>
          </Field>
          <TextField label="Pay (optional)" placeholder="₹6–8 LPA" maxLength={80} value={f.salary} onChange={set("salary")} />
          <TextField label="Apply by (optional)" type="datetime-local" value={f.deadline} onChange={set("deadline")} />
        </div>
        <Field label="Description" error={errors.description}>
          <Textarea rows={5} required minLength={10} maxLength={10_000} value={f.description} onChange={set("description")} placeholder="The role, what they'll do, what you're looking for" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
          <TextField label="Skills (comma separated)" placeholder="React, SQL, Git" value={f.skills} onChange={set("skills")} error={errors.skills} />
          <TextField label="Minimum readiness (%)" hint="Optional. Below it, students can't apply" type="number" min={1} max={100} value={f.minReadiness} onChange={set("minReadiness")} />
        </div>
        <Field label="Campus drive (optional): only these batches can apply">
          <div className="flex max-h-36 flex-wrap gap-2 overflow-y-auto rounded-md border border-line p-2">
            {batches.data?.length ? (
              batches.data.map((b) => {
                const on = f.batchIds.includes(b.id);
                return (
                  <label key={b.id} className={cx("flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs", on ? "border-brand bg-brand-soft text-brand-strong" : "border-line text-muted hover:bg-canvas")}>
                    <input
                      type="checkbox"
                      className="size-3.5 accent-brand"
                      checked={on}
                      onChange={() => setF({ ...f, batchIds: on ? f.batchIds.filter((x) => x !== b.id) : [...f.batchIds, b.id] })}
                    />
                    {b.name}
                  </label>
                );
              })
            ) : (
              <span className="text-xs text-muted">{batches.isPending ? "Loading batches…" : "No batches"}</span>
            )}
          </div>
        </Field>
        <p className="text-xs text-muted">{f.batchIds.length ? `Only students in ${f.batchIds.length} chosen batch(es) can see and apply.` : "No batch chosen: every student can see and apply."}</p>
        <ErrorBox error={save.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending}>
            {job ? "Save" : "Post job"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
