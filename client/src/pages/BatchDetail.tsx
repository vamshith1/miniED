import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Download, FileText, Pencil, Plus, UserMinus } from "lucide-react";
import { api, downloadFile } from "../lib/api";
import { useUser } from "../lib/auth";
import { fmtBytes, fmtDate, fmtDay, fmtPct, fmtSeconds, todayYmd } from "../lib/format";
import type { AttendanceDay, AttendanceStatus, Batch, BatchAttendanceSummary, DocumentInfo, Paginated, QuizSummary, Student, User } from "../lib/types";
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, QueryState, Select, Spinner, Table, Tabs, Td, Th, cx, askConfirm } from "../components/ui";
import { BatchLeaderboardTable } from "../components/Leaderboards";
import { BatchFormModal, batchStatus } from "./Batches";

type Tab = "students" | "attendance" | "quizzes" | "leaderboard";

export function BatchDetailPage() {
  const { id } = useParams() as { id: string };
  const user = useUser();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab) ?? "students";
  const [editing, setEditing] = useState(false);
  const batch = useQuery({ queryKey: ["batch", id], queryFn: () => api.get<{ batch: Batch }>(`/batches/${id}`).then((r) => r.batch) });

  return (
    <>
      <Link to="/batches" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Batches
      </Link>
      <QueryState query={batch}>
        {(b) => (
          <>
            <PageHeader
              title={
                <span className="flex items-center gap-2">
                  {b.name} <Badge tone={batchStatus(b).tone}>{batchStatus(b).label}</Badge>
                </span>
              }
              subtitle={`${b.course} · ${fmtDay(b.startDate)}${b.endDate ? ` – ${fmtDay(b.endDate)}` : " onwards"} · mentor: ${b.mentor?.name ?? "none"}`}
              actions={
                user.role === "ADMIN" && (
                  <Button variant="secondary" onClick={() => setEditing(true)}>
                    <Pencil className="size-4" /> Edit
                  </Button>
                )
              }
            />
            <Tabs<Tab>
              value={tab}
              onChange={(t) => setParams({ tab: t }, { replace: true })}
              tabs={[
                { id: "students", label: `Students (${b._count.students})` },
                { id: "attendance", label: "Attendance" },
                { id: "quizzes", label: "Quizzes" },
                { id: "leaderboard", label: "Leaderboard" },
              ]}
            />
            {tab === "students" && <StudentsTab batch={b} />}
            {tab === "attendance" && <AttendanceTab batch={b} />}
            {tab === "quizzes" && <QuizzesTab batch={b} />}
            {tab === "leaderboard" && (
              <Card padded={false}>
                <BatchLeaderboardTable batchId={b.id} />
              </Card>
            )}
            {user.role === "ADMIN" && <BatchFormModal key={b.id + editing} open={editing} onClose={() => setEditing(false)} batch={b} />}
          </>
        )}
      </QueryState>
    </>
  );
}

// ---------- Students

function StudentsTab({ batch }: { batch: Batch }) {
  const user = useUser();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [resumesFor, setResumesFor] = useState<Student | null>(null);
  const students = useQuery({ queryKey: ["students", batch.id], queryFn: () => api.get<{ items: Student[] }>(`/batches/${batch.id}/students`).then((r) => r.items) });
  const summary = useQuery({ queryKey: ["attendance-summary", batch.id], queryFn: () => api.get<BatchAttendanceSummary>(`/batches/${batch.id}/attendance/summary`) });
  const pctById = new Map(summary.data?.items.map((i) => [i.student.id, i.percentage]));
  const remove = useMutation({
    mutationFn: (s: Student) => api.del(`/batches/${batch.id}/students/${s.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["students", batch.id] });
      qc.invalidateQueries({ queryKey: ["batch", batch.id] });
      qc.invalidateQueries({ queryKey: ["batches"] });
    },
  });

  return (
    <Card
      padded={false}
      title="Roster"
      actions={
        user.role === "ADMIN" && (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus className="size-4" /> Add student
          </Button>
        )
      }
    >
      <ErrorBox error={remove.error} />
      <QueryState query={students}>
        {(items) =>
          items.length === 0 ? (
            <EmptyState title="No students yet">{user.role === "ADMIN" ? "Enroll a lead, or add an existing student." : "An admin adds students to the batch."}</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Student</Th>
                  <Th>Phone</Th>
                  <Th className="text-right">Attendance</Th>
                  <Th className="text-right">Resume</Th>
                  {user.role === "ADMIN" && <Th />}
                </tr>
              </thead>
              <tbody>
                {items.map((s) => {
                  const pct = pctById.get(s.id);
                  return (
                    <tr key={s.id}>
                      <Td>
                        <div className="font-medium">
                          {s.name} {!s.isActive && <Badge tone="bad">Deactivated</Badge>}
                        </div>
                        <div className="text-xs text-muted">{s.email}</div>
                      </Td>
                      <Td className="text-muted">{s.phone ?? "—"}</Td>
                      <Td className={cx("text-right tabular-nums", pct !== null && pct !== undefined && pct < 75 && "font-medium text-bad")}>{fmtPct(pct)}</Td>
                      <Td className="text-right">
                        <Button size="sm" variant="ghost" onClick={() => setResumesFor(s)}>
                          <FileText className="size-4" /> View
                        </Button>
                      </Td>
                      {user.role === "ADMIN" && (
                        <Td className="text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Remove ${s.name} from batch`}
                            onClick={async () => (await askConfirm(`Remove ${s.name} from ${batch.name}? Their account stays.`, { confirmLabel: "Remove", danger: true })) && remove.mutate(s)}
                          >
                            <UserMinus className="size-4" />
                          </Button>
                        </Td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )
        }
      </QueryState>
      {[...pctById.values()].some((p) => p !== null) && <p className="px-4 py-2 text-xs text-faint">Attendance below 75% is shown in red. Late counts as attended.</p>}
      {user.role === "ADMIN" && <AddStudentModal batch={batch} open={adding} onClose={() => setAdding(false)} />}
      <StudentDocumentsModal student={resumesFor} onClose={() => setResumesFor(null)} />
    </Card>
  );
}

function StudentDocumentsModal({ student, onClose }: { student: Student | null; onClose: () => void }) {
  const docs = useQuery({
    queryKey: ["documents", student?.id],
    queryFn: () => api.get<{ items: DocumentInfo[] }>(`/documents?ownerId=${student!.id}`).then((r) => r.items),
    enabled: !!student,
  });
  const [error, setError] = useState<unknown>(null);
  return (
    <Modal open={!!student} onClose={onClose} title={`${student?.name ?? ""}'s documents`}>
      <ErrorBox error={error} />
      <QueryState query={docs}>
        {(items) =>
          items.length === 0 ? (
            <EmptyState title="Nothing uploaded yet" />
          ) : (
            <ul className="divide-y divide-line">
              {items.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{d.originalName}</p>
                    <p className="text-xs text-muted">
                      {d.kind === "RESUME" ? "Resume" : "Other"} · {fmtBytes(d.sizeBytes)} · {fmtDate(d.createdAt)}
                    </p>
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => downloadFile(`/documents/${d.id}/download`, d.originalName).catch(setError)}>
                    <Download className="size-4" /> Download
                  </Button>
                </li>
              ))}
            </ul>
          )
        }
      </QueryState>
    </Modal>
  );
}

function AddStudentModal({ batch, open, onClose }: { batch: Batch; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [studentId, setStudentId] = useState("");
  const all = useQuery({
    queryKey: ["users", "STUDENT", "all"],
    queryFn: () => api.get<Paginated<User>>("/users?role=STUDENT&limit=100").then((r) => r.items),
    enabled: open,
  });
  const candidates = (all.data ?? []).filter((s) => s.batchId !== batch.id && s.isActive);
  const chosen = candidates.find((s) => s.id === studentId);
  const add = useMutation({
    mutationFn: () => api.post(`/batches/${batch.id}/students`, { studentId }),
    onSuccess: () => {
      ["students", "batch", "batches", "attendance-summary"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      setStudentId("");
      onClose();
    },
  });
  return (
    <Modal open={open} onClose={onClose} title={`Add a student to ${batch.name}`}>
      {all.isPending ? (
        <Spinner />
      ) : candidates.length === 0 ? (
        <EmptyState title="No other students">To add someone new, enroll them from the Leads page.</EmptyState>
      ) : (
        <div className="space-y-3">
          <Field label="Student">
            <Select value={studentId} onChange={(e) => setStudentId(e.target.value)}>
              <option value="">Choose a student</option>
              {candidates.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.email}
                  {s.batchId ? " (in another batch)" : ""}
                </option>
              ))}
            </Select>
          </Field>
          {chosen?.batchId && <p className="text-sm text-warn">They'll be moved out of their current batch.</p>}
          <ErrorBox error={add.error} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={!studentId} loading={add.isPending} onClick={() => add.mutate()}>
              Add to batch
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---------- Attendance

const STATUS_OPTIONS: { value: AttendanceStatus; label: string; on: string }[] = [
  { value: "PRESENT", label: "Present", on: "border-good bg-good-soft text-good" },
  { value: "LATE", label: "Late", on: "border-warn bg-warn-soft text-warn" },
  { value: "ABSENT", label: "Absent", on: "border-bad bg-bad-soft text-bad" },
];

function AttendanceTab({ batch }: { batch: Batch }) {
  const qc = useQueryClient();
  const maxDate = batch.endDate && batch.endDate.slice(0, 10) < todayYmd() ? batch.endDate.slice(0, 10) : todayYmd();
  const minDate = batch.startDate.slice(0, 10);
  const [date, setDate] = useState(maxDate < minDate ? minDate : maxDate);
  const notStarted = minDate > todayYmd();
  const day = useQuery({
    queryKey: ["attendance", batch.id, date],
    queryFn: () => api.get<AttendanceDay>(`/batches/${batch.id}/attendance?date=${date}`),
    enabled: !notStarted,
  });
  const summary = useQuery({ queryKey: ["attendance-summary", batch.id], queryFn: () => api.get<BatchAttendanceSummary>(`/batches/${batch.id}/attendance/summary`) });

  // Local edits for the selected day, reset whenever a new day loads.
  const [marks, setMarks] = useState<Record<string, AttendanceStatus | null>>({});
  useEffect(() => {
    if (day.data) setMarks(Object.fromEntries(day.data.items.map((i) => [i.student.id, i.status])));
  }, [day.data]);
  const saved = useMemo(() => Object.fromEntries((day.data?.items ?? []).map((i) => [i.student.id, i.status])), [day.data]);
  const dirty = Object.keys(marks).some((k) => marks[k] !== saved[k]);
  const records = Object.entries(marks)
    .filter(([, s]) => s)
    .map(([studentId, status]) => ({ studentId, status }));

  const save = useMutation({
    mutationFn: () => api.put(`/batches/${batch.id}/attendance`, { date, records }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["attendance", batch.id, date] });
      qc.invalidateQueries({ queryKey: ["attendance-summary", batch.id] });
    },
  });

  if (notStarted) return <Card><EmptyState title="This batch hasn't started yet">Attendance opens on {fmtDay(minDate)}.</EmptyState></Card>;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Card
        padded={false}
        title="Mark a day"
        actions={
          <>
            <Input type="date" className="w-auto" value={date} min={minDate} max={maxDate} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Date" />
            <Button size="sm" variant="secondary" onClick={() => setMarks(Object.fromEntries(Object.keys(marks).map((k) => [k, marks[k] ?? "PRESENT"])))}>
              Unmarked → present
            </Button>
          </>
        }
      >
        <QueryState query={day}>
          {(d) =>
            d.items.length === 0 ? (
              <EmptyState title="No students in this batch" />
            ) : (
              <>
                <ul className="divide-y divide-line">
                  {d.items.map(({ student }) => (
                    <li key={student.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                      <span className="text-sm font-medium">{student.name}</span>
                      <div className="flex gap-1" role="radiogroup" aria-label={`${student.name} attendance`}>
                        {STATUS_OPTIONS.map((o) => (
                          <button
                            key={o.value}
                            role="radio"
                            aria-checked={marks[student.id] === o.value}
                            onClick={() => setMarks({ ...marks, [student.id]: o.value })}
                            className={cx("rounded-md border px-2.5 py-1 text-xs font-medium", marks[student.id] === o.value ? o.on : "border-line text-muted hover:text-ink")}
                          >
                            {o.label}
                          </button>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3">
                  <p className="text-sm text-muted">
                    {records.length}/{d.items.length} marked for {fmtDay(date)}
                    {dirty && <span className="text-warn"> · unsaved changes</span>}
                  </p>
                  <Button disabled={!dirty || records.length === 0} loading={save.isPending} onClick={() => save.mutate()}>
                    Save attendance
                  </Button>
                </div>
                <div className="px-4 pb-3"><ErrorBox error={save.error} /></div>
              </>
            )
          }
        </QueryState>
      </Card>

      <Card title="Attendance so far" actions={summary.data && <span className="text-sm text-muted">Average {fmtPct(summary.data.averagePercentage)}</span>}>
        <QueryState query={summary}>
          {(s) =>
            s.items.every((i) => i.total === 0) ? (
              <p className="text-sm text-muted">No days marked yet.</p>
            ) : (
              <ul className="space-y-2.5">
                {[...s.items]
                  .sort((a, b) => (a.percentage ?? 101) - (b.percentage ?? 101))
                  .map((i) => (
                    <li key={i.student.id}>
                      <div className="flex justify-between text-sm">
                        <span className="truncate">{i.student.name}</span>
                        <span className={cx("tabular-nums", i.percentage !== null && i.percentage < 75 ? "font-medium text-bad" : "text-muted")}>{fmtPct(i.percentage)}</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-canvas">
                        <div className={cx("h-full rounded-full", i.percentage !== null && i.percentage < 75 ? "bg-bad" : "bg-good")} style={{ width: `${i.percentage ?? 0}%` }} />
                      </div>
                      <p className="mt-0.5 text-xs text-faint">
                        {i.present} present · {i.late} late · {i.absent} absent
                      </p>
                    </li>
                  ))}
              </ul>
            )
          }
        </QueryState>
      </Card>
    </div>
  );
}

// ---------- Quizzes

function QuizzesTab({ batch }: { batch: Batch }) {
  const quizzes = useQuery({ queryKey: ["quizzes", batch.id], queryFn: () => api.get<{ items: QuizSummary[] }>(`/quizzes?batchId=${batch.id}`).then((r) => r.items) });
  return (
    <Card
      padded={false}
      title="Quizzes"
      actions={
        <Link to={`/quizzes/new?batchId=${batch.id}`}>
          <Button size="sm">
            <Plus className="size-4" /> New quiz
          </Button>
        </Link>
      }
    >
      <QueryState query={quizzes}>
        {(items) =>
          items.length === 0 ? (
            <EmptyState title="No quizzes yet">Create a draft, add questions, then publish it to the batch.</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Quiz</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Questions</Th>
                  <Th className="text-right">Time limit</Th>
                  <Th className="text-right">Attempts</Th>
                </tr>
              </thead>
              <tbody>
                {items.map((q) => (
                  <tr key={q.id} className="hover:bg-canvas/60">
                    <Td>
                      <Link to={`/quizzes/${q.id}`} className="font-medium hover:text-brand">
                        {q.title}
                      </Link>
                      <div className="text-xs text-muted">Created {fmtDate(q.createdAt)}</div>
                    </Td>
                    <Td>{q.isPublished ? <Badge tone="good">Published</Badge> : <Badge>Draft</Badge>}</Td>
                    <Td className="text-right tabular-nums">{q._count.questions}</Td>
                    <Td className="text-right">{fmtSeconds(q.durationSeconds)}</Td>
                    <Td className="text-right tabular-nums">{q._count.attempts}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )
        }
      </QueryState>
    </Card>
  );
}
