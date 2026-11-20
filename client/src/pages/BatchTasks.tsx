import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ClipboardList, Copy, ExternalLink, KeyRound, Plus, RefreshCw, Trash2, Undo2 } from "lucide-react";
import { api } from "../lib/api";
import { fmtDateTime } from "../lib/format";
import type { Batch, ManagedTask, Submission, SubmissionStatus, TaskSubmissions } from "../lib/types";
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, Modal, QueryState, Table, Td, TextField, Textarea, Th, askConfirm, cx, fieldErrorsOf } from "../components/ui";

export const submissionTone: Record<SubmissionStatus, "warn" | "bad" | "good"> = { SUBMITTED: "warn", CHANGES_REQUESTED: "bad", ACCEPTED: "good" };
export const submissionLabel: Record<SubmissionStatus, string> = { SUBMITTED: "Waiting for review", CHANGES_REQUESTED: "Changes requested", ACCEPTED: "Accepted" };

// "2026-11-20T18:30" for a datetime-local input, in the viewer's own time zone.
const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

export const isOverdue = (dueAt: string | null) => !!dueAt && new Date(dueAt) < new Date();

// ---------- Join code

/** Lets the batch's mentor or an admin hand out a code students can join with. */
export function JoinCodeCard({ batch }: { batch: Batch }) {
  const qc = useQueryClient();
  const [copied, setCopied] = useState(false);
  const change = useMutation({
    mutationFn: async (on: boolean) => {
      await (on ? api.post(`/batches/${batch.id}/join-code`) : api.del(`/batches/${batch.id}/join-code`));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["batch", batch.id] }),
  });
  const shown = batch.joinCode ? `${batch.joinCode.slice(0, 4)}-${batch.joinCode.slice(4)}` : null;
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <KeyRound className="size-4 text-brand-strong" /> Join code
        </span>
      }
      className="mb-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        {shown ? (
          <div className="flex items-center gap-3">
            <code className="rounded-md bg-brand-soft px-3 py-1.5 font-mono text-lg font-semibold tracking-widest text-brand-strong">{shown}</code>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                navigator.clipboard?.writeText(shown).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                });
              }}
            >
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />} {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted">Off. Turn it on to let students who signed up themselves join this batch with a code.</p>
        )}
        <div className="flex gap-2">
          {shown && (
            <Button size="sm" variant="secondary" loading={change.isPending && change.variables === false} onClick={() => change.mutate(false)}>
              Turn off
            </Button>
          )}
          <Button
            size="sm"
            variant={shown ? "secondary" : "primary"}
            loading={change.isPending && change.variables === true}
            onClick={async () => (!shown || (await askConfirm("Make a new code? The current one stops working.", { confirmLabel: "New code" }))) && change.mutate(true)}
          >
            <RefreshCw className="size-4" /> {shown ? "New code" : "Turn on"}
          </Button>
        </div>
      </div>
      {shown && <p className="mt-2 text-xs text-muted">Students enter it on their home page after signing up. Anyone with the code can join, so share it only with your students.</p>}
      <ErrorBox error={change.error} />
    </Card>
  );
}

// ---------- Tasks tab

export function TasksTab({ batch }: { batch: Batch }) {
  const [creating, setCreating] = useState(false);
  const [reviewing, setReviewing] = useState<ManagedTask | null>(null);
  const tasks = useQuery({ queryKey: ["tasks", batch.id], queryFn: () => api.get<{ items: ManagedTask[] }>(`/tasks?batchId=${batch.id}`).then((r) => r.items) });

  return (
    <Card
      padded={false}
      title="Tasks"
      actions={
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="size-4" /> New task
        </Button>
      }
    >
      <QueryState query={tasks}>
        {(items) =>
          items.length === 0 ? (
            <EmptyState title="No tasks yet">Set assignments or mini projects. Students hand in a link (GitHub, Drive…) or a note, and you review them here.</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Task</Th>
                  <Th>Due</Th>
                  <Th className="text-right">Handed in</Th>
                  <Th className="text-right">To review</Th>
                  <Th className="text-right">Accepted</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {items.map((t) => (
                  <tr key={t.id}>
                    <Td>
                      <div className="font-medium">{t.title}</div>
                      <div className="text-xs text-muted">{t.maxPoints ? `${t.maxPoints} points` : "Not graded"} · by {t.createdBy.name}</div>
                    </Td>
                    <Td className={cx("whitespace-nowrap", isOverdue(t.dueAt) ? "text-muted" : "")}>{t.dueAt ? fmtDateTime(t.dueAt) : "—"}</Td>
                    <Td className="text-right tabular-nums">
                      {t.submitted}/{t.students}
                    </Td>
                    <Td className="text-right">{t.toReview > 0 ? <Badge tone="warn">{t.toReview}</Badge> : <span className="text-faint">0</span>}</Td>
                    <Td className="text-right tabular-nums">{t.accepted}</Td>
                    <Td className="text-right">
                      <Button size="sm" variant="secondary" onClick={() => setReviewing(t)}>
                        <ClipboardList className="size-4" /> Review
                      </Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )
        }
      </QueryState>
      <TaskFormModal batch={batch} open={creating} onClose={() => setCreating(false)} />
      {reviewing && <ReviewModal task={reviewing} batchId={batch.id} onClose={() => setReviewing(null)} />}
    </Card>
  );
}

function TaskFormModal({ batch, open, onClose }: { batch: Batch; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const blank = { title: "", description: "", due: "", points: "" };
  const [f, setF] = useState(blank);
  const create = useMutation({
    mutationFn: () =>
      api.post("/tasks", {
        batchId: batch.id,
        title: f.title,
        description: f.description || null,
        dueAt: f.due ? new Date(f.due).toISOString() : null,
        maxPoints: f.points ? Number(f.points) : null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks", batch.id] });
      setF(blank);
      onClose();
    },
  });
  const errors = fieldErrorsOf(create.error);
  return (
    <Modal open={open} onClose={onClose} title="New task">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <TextField label="Title" required minLength={2} maxLength={200} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} error={errors.title} />
        <Field label="What to do (optional)">
          <Textarea rows={4} maxLength={5000} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Due (optional)" type="datetime-local" min={toLocalInput(new Date().toISOString())} value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} />
          <TextField label="Points (optional)" hint="Leave empty to review without grading" type="number" min={1} max={1000} value={f.points} onChange={(e) => setF({ ...f, points: e.target.value })} />
        </div>
        <ErrorBox error={create.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={create.isPending}>
            Set task
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ReviewModal({ task, batchId, onClose }: { task: ManagedTask; batchId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const subs = useQuery({ queryKey: ["task-submissions", task.id], queryFn: () => api.get<TaskSubmissions>(`/tasks/${task.id}/submissions`) });
  const remove = useMutation({
    mutationFn: () => api.del(`/tasks/${task.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks", batchId] });
      onClose();
    },
  });
  return (
    <Modal open onClose={onClose} title={task.title} wide>
      {task.description && <p className="mb-3 whitespace-pre-line text-sm text-muted">{task.description}</p>}
      <p className="mb-3 text-xs text-muted">
        {task.dueAt ? `Due ${fmtDateTime(task.dueAt)}` : "No due date"} · {task.maxPoints ? `out of ${task.maxPoints} points` : "not graded"}
      </p>
      <QueryState query={subs}>
        {({ items }) =>
          items.length === 0 ? (
            <EmptyState title="No students in this batch" />
          ) : (
            <ul className="divide-y divide-line rounded-lg border border-line">
              {items.map(({ student, submission }) => (
                <li key={student.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-medium">{student.name}</p>
                      <p className="text-xs text-muted">{student.email}</p>
                    </div>
                    {submission ? (
                      <span className="flex items-center gap-1.5">
                        {submission.late && <Badge tone="bad">Late</Badge>}
                        <Badge tone={submissionTone[submission.status]}>{submissionLabel[submission.status]}</Badge>
                        {submission.points != null && <Badge tone="good">{submission.points}/{task.maxPoints}</Badge>}
                      </span>
                    ) : (
                      <Badge>{isOverdue(task.dueAt) ? "Missing" : "Not handed in"}</Badge>
                    )}
                  </div>
                  {submission && <SubmissionReview task={task} batchId={batchId} submission={submission} />}
                </li>
              ))}
            </ul>
          )
        }
      </QueryState>
      <div className="mt-4 flex justify-between">
        <Button
          variant="danger"
          loading={remove.isPending}
          onClick={async () => (await askConfirm("Delete this task and everything handed in for it? This can't be undone.", { confirmLabel: "Delete", danger: true })) && remove.mutate()}
        >
          <Trash2 className="size-4" /> Delete task
        </Button>
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
      <ErrorBox error={remove.error} />
    </Modal>
  );
}

function SubmissionReview({ task, batchId, submission }: { task: ManagedTask; batchId: string; submission: Submission }) {
  const qc = useQueryClient();
  const [points, setPoints] = useState(submission.points?.toString() ?? "");
  const [feedback, setFeedback] = useState(submission.feedback ?? "");
  const review = useMutation({
    mutationFn: (status: "ACCEPTED" | "CHANGES_REQUESTED") =>
      api.patch(`/tasks/${task.id}/submissions/${submission.id}`, { status, points: task.maxPoints && points !== "" ? Number(points) : null, feedback: feedback || null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["task-submissions", task.id] });
      qc.invalidateQueries({ queryKey: ["tasks", batchId] });
    },
  });
  return (
    <div className="mt-2 space-y-2 rounded-md bg-canvas p-3 text-sm">
      <p className="text-xs text-muted">Handed in {fmtDateTime(submission.submittedAt)}</p>
      {submission.link && (
        <a href={submission.link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 break-all font-medium text-brand-strong hover:underline">
          <ExternalLink className="size-3.5 shrink-0" /> {submission.link}
        </a>
      )}
      {submission.note && <p className="whitespace-pre-line">{submission.note}</p>}
      <div className="grid gap-2 sm:grid-cols-[110px_1fr]">
        {task.maxPoints ? (
          <Input type="number" min={0} max={task.maxPoints} placeholder={`/ ${task.maxPoints}`} value={points} onChange={(e) => setPoints(e.target.value)} aria-label="Points" />
        ) : (
          <span />
        )}
        <Input placeholder="Feedback for the student (optional)" value={feedback} maxLength={5000} onChange={(e) => setFeedback(e.target.value)} aria-label="Feedback" />
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button size="sm" variant="secondary" loading={review.isPending && review.variables === "CHANGES_REQUESTED"} onClick={() => review.mutate("CHANGES_REQUESTED")}>
          <Undo2 className="size-4" /> Ask for changes
        </Button>
        <Button size="sm" loading={review.isPending && review.variables === "ACCEPTED"} onClick={() => review.mutate("ACCEPTED")}>
          <Check className="size-4" /> Accept
        </Button>
      </div>
      <ErrorBox error={review.error} />
    </div>
  );
}
