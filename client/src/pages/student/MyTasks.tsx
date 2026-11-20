import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, ExternalLink, MessageSquare, Upload } from "lucide-react";
import { api } from "../../lib/api";
import { fmtDateTime, relative } from "../../lib/format";
import type { StudentTask } from "../../lib/types";
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Modal, PageHeader, QueryState, Stat, TextField, Textarea, cx, fieldErrorsOf } from "../../components/ui";
import { isOverdue, submissionLabel, submissionTone } from "../BatchTasks";

export function MyTasksPage() {
  const [handingIn, setHandingIn] = useState<StudentTask | null>(null);
  const tasks = useQuery({ queryKey: ["tasks", "mine"], queryFn: () => api.get<{ items: StudentTask[] }>("/tasks").then((r) => r.items) });

  return (
    <>
      <PageHeader title="My tasks" subtitle="Assignments from your mentor. Hand in a link or a note; your mentor reviews it here." />
      <QueryState query={tasks}>
        {(items) => {
          const todo = items.filter((t) => !t.mySubmission || t.mySubmission.status === "CHANGES_REQUESTED");
          const waiting = items.filter((t) => t.mySubmission?.status === "SUBMITTED");
          const done = items.filter((t) => t.mySubmission?.status === "ACCEPTED");
          if (items.length === 0)
            return (
              <Card>
                <EmptyState title="No tasks yet">When your mentor sets one, it shows up here.</EmptyState>
              </Card>
            );
          return (
            <>
              <div className="mb-4 grid gap-3 sm:grid-cols-3">
                <Stat label="To do" value={todo.length} tone={todo.some((t) => isOverdue(t.dueAt)) ? "bad" : undefined} hint={todo.some((t) => isOverdue(t.dueAt)) ? "Some are overdue" : "Including ones sent back"} />
                <Stat label="Waiting for review" value={waiting.length} />
                <Stat label="Accepted" value={done.length} tone={done.length ? "good" : undefined} hint={`of ${items.length} set`} />
              </div>
              <ul className="space-y-3">
                {items.map((t) => (
                  <li key={t.id}>
                    <TaskCard task={t} onHandIn={() => setHandingIn(t)} />
                  </li>
                ))}
              </ul>
            </>
          );
        }}
      </QueryState>
      {handingIn && <HandInModal task={handingIn} onClose={() => setHandingIn(null)} />}
    </>
  );
}

function TaskCard({ task, onHandIn }: { task: StudentTask; onHandIn: () => void }) {
  const s = task.mySubmission;
  const overdue = isOverdue(task.dueAt) && (!s || s.status === "CHANGES_REQUESTED");
  return (
    <Card
      title={task.title}
      actions={
        <span className="flex items-center gap-1.5">
          {s?.late && <Badge tone="bad">Handed in late</Badge>}
          {s ? <Badge tone={submissionTone[s.status]}>{submissionLabel[s.status]}</Badge> : overdue ? <Badge tone="bad">Overdue</Badge> : <Badge>To do</Badge>}
          {s?.points != null && <Badge tone="good">{s.points}/{task.maxPoints}</Badge>}
        </span>
      }
    >
      {task.description && <p className="mb-2 whitespace-pre-line text-sm">{task.description}</p>}
      <p className={cx("flex items-center gap-1.5 text-xs", overdue ? "font-medium text-bad" : "text-muted")}>
        <CalendarClock className="size-3.5" />
        {task.dueAt ? `Due ${fmtDateTime(task.dueAt)} (${relative(task.dueAt)})` : "No due date"} · {task.maxPoints ? `${task.maxPoints} points` : "not graded"}
      </p>
      {s && (
        <div className="mt-3 space-y-1.5 rounded-md bg-canvas p-3 text-sm">
          <p className="text-xs text-muted">You handed in {fmtDateTime(s.submittedAt)}</p>
          {s.link && (
            <a href={s.link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 break-all font-medium text-brand-strong hover:underline">
              <ExternalLink className="size-3.5 shrink-0" /> {s.link}
            </a>
          )}
          {s.note && <p className="whitespace-pre-line">{s.note}</p>}
          {s.feedback && (
            <p className="flex gap-2 border-t border-line pt-2">
              <MessageSquare className="mt-0.5 size-4 shrink-0 text-brand-strong" />
              <span>
                <span className="font-medium">{s.reviewedBy?.name ?? "Mentor"}:</span> {s.feedback}
              </span>
            </p>
          )}
        </div>
      )}
      {s?.status !== "ACCEPTED" && (
        <div className="mt-3 flex justify-end">
          <Button size="sm" variant={s ? "secondary" : "primary"} onClick={onHandIn}>
            <Upload className="size-4" /> {s ? "Hand in again" : "Hand in"}
          </Button>
        </div>
      )}
    </Card>
  );
}

function HandInModal({ task, onClose }: { task: StudentTask; onClose: () => void }) {
  const qc = useQueryClient();
  const [link, setLink] = useState(task.mySubmission?.link ?? "");
  const [note, setNote] = useState(task.mySubmission?.note ?? "");
  const submit = useMutation({
    mutationFn: () => api.put(`/tasks/${task.id}/submission`, { link: link.trim() || null, note: note.trim() || null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks", "mine"] });
      onClose();
    },
  });
  const errors = fieldErrorsOf(submit.error);
  return (
    <Modal open onClose={onClose} title={`Hand in: ${task.title}`}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit.mutate();
        }}
      >
        <TextField label="Link to your work" type="url" placeholder="https://github.com/you/project" value={link} onChange={(e) => setLink(e.target.value)} error={errors.link} />
        <Field label="Note for your mentor" error={errors.note}>
          <Textarea rows={4} maxLength={5000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What you did, anything you got stuck on…" />
        </Field>
        <p className="text-xs text-muted">Add a link, a note, or both. Handing in again replaces what you sent before.</p>
        <ErrorBox error={submit.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={submit.isPending} disabled={!link.trim() && !note.trim()}>
            Hand in
          </Button>
        </div>
      </form>
    </Modal>
  );
}
