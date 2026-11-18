import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Check, Cloud, CloudOff, History, Loader2, Plus, RotateCcw, Send, Trash2, X } from "lucide-react";
import { api } from "../lib/api";
import { fmtDateTime, fmtDuration, fmtSeconds, relative } from "../lib/format";
import { clearBackup, readBackup, useLeaveWarning, writeBackup, type Backup } from "../lib/draft-backup";
import type { Attempt, Batch, FullQuiz } from "../lib/types";
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, PageHeader, QueryState, Table, Tabs, Td, TextField, Textarea, Th, cx, askConfirm } from "../components/ui";
import { QuizLeaderboardTable } from "../components/Leaderboards";

// The draft as edited in the form (no ids: PUT replaces every question).
interface DraftOption { text: string; isCorrect: boolean }
interface DraftQuestion { text: string; points: number; options: DraftOption[] }
interface Draft { title: string; description: string; minutes: number; questions: DraftQuestion[] }

const blankQuestion = (): DraftQuestion => ({ text: "", points: 1, options: [{ text: "", isCorrect: true }, { text: "", isCorrect: false }] });

const toDraft = (q: FullQuiz): Draft => ({
  title: q.title,
  description: q.description ?? "",
  minutes: Math.round((q.durationSeconds / 60) * 10) / 10,
  questions: q.questions.map((x) => ({ text: x.text, points: x.points, options: x.options.map((o) => ({ text: o.text, isCorrect: !!o.isCorrect })) })),
});

const toBody = (d: Draft) => ({
  title: d.title.trim(),
  ...(d.description.trim() && { description: d.description.trim() }),
  durationSeconds: Math.round(d.minutes * 60),
  questions: d.questions.map((q) => ({ text: q.text.trim(), points: q.points, options: q.options.map((o) => ({ text: o.text.trim(), isCorrect: o.isCorrect })) })),
});

// Problems the server would reject, shown before saving.
function problems(d: Draft) {
  const out: string[] = [];
  if (d.title.trim().length < 2) out.push("Give the quiz a title.");
  if (!(d.minutes >= 0.5 && d.minutes <= 180)) out.push("The time limit must be between 30 seconds and 3 hours.");
  d.questions.forEach((q, i) => {
    if (!q.text.trim()) out.push(`Question ${i + 1} has no text.`);
    if (q.options.some((o) => !o.text.trim())) out.push(`Question ${i + 1} has an empty option.`);
  });
  return out;
}

export function QuizEditorPage() {
  const { id } = useParams();
  return id ? <ExistingQuiz id={id} /> : <NewQuiz />;
}

// Wait this long after the last edit before autosaving.
const AUTOSAVE_MS = 1500;

const blankDraft = (): Draft => ({ title: "", description: "", minutes: 10, questions: [blankQuestion()] });
const BLANK_JSON = JSON.stringify(blankDraft());

/** Offers back unsaved work found on this device (after a reload, crash or closed tab). */
function RestoreBanner({ backup, onRestore, onDiscard }: { backup: Backup<Draft>; onRestore: () => void; onDiscard: () => void }) {
  return (
    <div className="animate-fade-up mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-brand/30 bg-brand-soft px-4 py-3" role="status">
      <p className="flex items-center gap-2 text-sm text-ink">
        <History className="size-4 shrink-0 text-brand-strong" />
        <span>
          Unsaved changes from <strong>{relative(backup.savedAt)}</strong> were found on this device.
        </span>
      </p>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" onClick={onDiscard}>
          Discard
        </Button>
        <Button size="sm" onClick={onRestore}>
          <RotateCcw className="size-4" /> Restore them
        </Button>
      </div>
    </div>
  );
}

function NewQuiz() {
  const [params] = useSearchParams();
  const batchId = params.get("batchId") ?? "";
  const navigate = useNavigate();
  const qc = useQueryClient();
  const backupKey = `new-quiz:${batchId}`;
  const batch = useQuery({ queryKey: ["batch", batchId], queryFn: () => api.get<{ batch: Batch }>(`/batches/${batchId}`).then((r) => r.batch), enabled: !!batchId });
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [restorable, setRestorable] = useState(() => {
    const b = readBackup<Draft>(backupKey);
    return b && JSON.stringify(b.draft) !== BLANK_JSON ? b : null;
  });
  const draftJson = JSON.stringify(draft);
  const started = draftJson !== BLANK_JSON;
  const create = useMutation({
    mutationFn: () => api.post<{ quiz: FullQuiz }>("/quizzes", { batchId, ...toBody(draft) }),
    onSuccess: ({ quiz }) => {
      clearBackup(backupKey);
      qc.invalidateQueries({ queryKey: ["quizzes", batchId] });
      navigate(`/quizzes/${quiz.id}`, { replace: true });
    },
  });

  // Keep a copy on this device while it's being written (left alone until a found copy is restored or discarded).
  useEffect(() => {
    if (restorable || !batchId || create.isSuccess) return;
    if (started) writeBackup(backupKey, draft);
    else clearBackup(backupKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftJson, restorable, backupKey]);
  useLeaveWarning(started && !create.isSuccess);

  if (!batchId) return <EmptyState title="Open a batch first">Quizzes are created from a batch's Quizzes tab.</EmptyState>;
  const issues = problems(draft);
  return (
    <>
      <BackToBatch batchId={batchId} />
      <PageHeader title="New quiz" subtitle={batch.data ? `For ${batch.data.name}. It stays a draft, hidden from students, until you publish it.` : undefined} />
      {restorable && (
        <RestoreBanner
          backup={restorable}
          onRestore={() => {
            setDraft(restorable.draft);
            setRestorable(null);
          }}
          onDiscard={() => {
            clearBackup(backupKey);
            setRestorable(null);
          }}
        />
      )}
      <DraftForm draft={draft} onChange={setDraft} />
      <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
        {issues.length > 0 && <p className="text-sm text-muted">{issues[0]}</p>}
        <Button disabled={issues.length > 0} loading={create.isPending} onClick={() => create.mutate()}>
          Save draft
        </Button>
      </div>
      <div className="mt-2"><ErrorBox error={create.error} /></div>
    </>
  );
}

// `warn`: ask before leaving, because some changes can't be saved yet.
function BackToBatch({ batchId, warn }: { batchId: string; warn?: string }) {
  const navigate = useNavigate();
  const to = `/batches/${batchId}?tab=quizzes`;
  return (
    <Link
      to={to}
      onClick={async (e) => {
        if (!warn) return;
        e.preventDefault();
        if (await askConfirm(warn, { confirmLabel: "Leave anyway", danger: true })) navigate(to);
      }}
      className="mb-3 inline-flex items-center gap-1 text-sm text-muted transition-colors hover:text-brand-strong"
    >
      <ArrowLeft className="size-4" /> Batch quizzes
    </Link>
  );
}

function ExistingQuiz({ id }: { id: string }) {
  const quiz = useQuery({ queryKey: ["quiz", id], queryFn: () => api.get<{ quiz: FullQuiz }>(`/quizzes/${id}`).then((r) => r.quiz) });
  return (
    <QueryState query={quiz}>
      {(q) => (
        <>
          {q.isPublished ? (
            <>
              <BackToBatch batchId={q.batch.id} />
              <PublishedQuiz quiz={q} />
            </>
          ) : (
            <DraftQuiz key={q.id} quiz={q} />
          )}
        </>
      )}
    </QueryState>
  );
}

function DraftQuiz({ quiz }: { quiz: FullQuiz }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const backupKey = `quiz:${quiz.id}`;
  const [draft, setDraft] = useState(() => toDraft(quiz));
  const [savedJson, setSavedJson] = useState(() => JSON.stringify(toDraft(quiz)));
  // A copy found on this device that differs from the server (say, after a reload mid-edit).
  const [restorable, setRestorable] = useState(() => {
    const b = readBackup<Draft>(backupKey);
    return b && JSON.stringify(b.draft) !== JSON.stringify(toDraft(quiz)) ? b : null;
  });
  const draftJson = JSON.stringify(draft);
  const dirty = draftJson !== savedJson;
  const issues = problems(draft);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["quiz", quiz.id] });
    qc.invalidateQueries({ queryKey: ["quizzes", quiz.batch.id] });
  };

  // Saves a snapshot and remembers exactly what was saved, so edits made while
  // the request is in flight still count as unsaved.
  const putDraft = async (d: Draft) => {
    const res = await api.put<{ quiz: FullQuiz }>(`/quizzes/${quiz.id}`, toBody(d));
    qc.setQueryData(["quiz", quiz.id], res.quiz); // coming back to this page shows what was saved
    return JSON.stringify(d);
  };
  const save = useMutation({
    mutationFn: putDraft,
    onSuccess: (json) => {
      setSavedJson(json);
      qc.invalidateQueries({ queryKey: ["quizzes", quiz.batch.id] });
    },
  });
  const publish = useMutation({
    mutationFn: async () => {
      if (dirty) await putDraft(draft);
      return api.post(`/quizzes/${quiz.id}/publish`);
    },
    onSuccess: () => {
      clearBackup(backupKey);
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/quizzes/${quiz.id}`),
    onSuccess: () => {
      clearBackup(backupKey);
      qc.invalidateQueries({ queryKey: ["quizzes", quiz.batch.id] });
      navigate(`/batches/${quiz.batch.id}?tab=quizzes`);
    },
  });

  // 1. Keep a copy on this device of anything not yet saved (left alone while a found copy awaits a decision).
  useEffect(() => {
    if (restorable || publish.isSuccess || remove.isSuccess) return;
    if (dirty) writeBackup(backupKey, draft);
    else clearBackup(backupKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftJson, savedJson, restorable]);

  // 2. Autosave a valid draft once typing pauses. A failed save isn't retried until the draft changes.
  const failedJson = save.isError ? JSON.stringify(save.variables) : null;
  const canAutosave = dirty && issues.length === 0 && !restorable && !save.isPending && !publish.isPending && !remove.isPending && failedJson !== draftJson;
  useEffect(() => {
    if (!canAutosave) return;
    const id = setTimeout(() => save.mutate(draft), AUTOSAVE_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAutosave, draftJson]);

  // 3. Closing or reloading the tab with unsaved changes asks first.
  useLeaveWarning(dirty);

  // 4. Leaving the page inside the app: save valid pending changes on the way out.
  const latest = useRef({ draft, dirty, valid: issues.length === 0, done: false });
  latest.current = { draft, dirty, valid: issues.length === 0, done: publish.isSuccess || remove.isSuccess };
  useEffect(
    () => () => {
      const l = latest.current;
      if (l.dirty && l.valid && !l.done) {
        putDraft(l.draft)
          .then(() => {
            clearBackup(backupKey);
            qc.invalidateQueries({ queryKey: ["quizzes", quiz.batch.id] });
          })
          .catch(() => {}); // the copy on this device is still there
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <>
      <BackToBatch
        batchId={quiz.batch.id}
        warn={
          dirty && issues.length > 0
            ? `Your latest changes can't be saved yet (${issues[0].replace(/\.$/, "")}). They stay on this device and are offered back when you return. Leave anyway?`
            : undefined
        }
      />
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {draft.title || "Untitled quiz"} <Badge>Draft</Badge>
          </span>
        }
        subtitle={`${quiz.batch.name} · only you and admins can see drafts.`}
        actions={
          <>
            <Button variant="danger" loading={remove.isPending} onClick={async () => (await askConfirm("Delete this draft?", { confirmLabel: "Delete", danger: true })) && remove.mutate()}>
              <Trash2 className="size-4" /> Delete
            </Button>
            <Button variant="secondary" disabled={!dirty || issues.length > 0 || !!restorable} loading={save.isPending} onClick={() => save.mutate(draft)}>
              {dirty ? "Save now" : "Saved"}
            </Button>
            <Button
              disabled={issues.length > 0 || draft.questions.length === 0 || !!restorable}
              loading={publish.isPending}
              onClick={async () => (await askConfirm("Publish to students? You won't be able to edit it afterwards.", { confirmLabel: "Publish" })) && publish.mutate()}
            >
              <Send className="size-4" /> Publish
            </Button>
          </>
        }
      />
      {restorable && (
        <RestoreBanner
          backup={restorable}
          onRestore={() => {
            setDraft(restorable.draft);
            setRestorable(null);
          }}
          onDiscard={() => {
            clearBackup(backupKey);
            setRestorable(null);
          }}
        />
      )}
      <div className="mb-3 space-y-2">
        {!restorable && <SaveStatus dirty={dirty} saving={save.isPending} failed={failedJson === draftJson} issue={issues[0]} />}
        <ErrorBox error={publish.error ?? remove.error ?? (failedJson === draftJson ? save.error : null)} />
      </div>
      <DraftForm draft={draft} onChange={setDraft} />
    </>
  );
}

// One line that always says where the work stands.
function SaveStatus({ dirty, saving, failed, issue }: { dirty: boolean; saving: boolean; failed: boolean; issue?: string }) {
  const [text, tone, icon] = saving
    ? ["Saving…", "text-muted", <Loader2 key="i" className="size-4 animate-spin" />]
    : failed
      ? ["Couldn't save. Your changes are kept on this device; edit again or press Save now to retry.", "text-bad", <CloudOff key="i" className="size-4" />]
      : dirty && issue
        ? [`Not saved yet: ${issue}`, "text-warn", <AlertTriangle key="i" className="size-4" />]
        : dirty
          ? ["Unsaved changes, saving automatically…", "text-muted", <Cloud key="i" className="size-4" />]
          : ["All changes saved", "text-good", <Check key="i" className="size-4" />];
  return (
    <p className={cx("flex items-center gap-1.5 text-sm transition-colors", tone)} aria-live="polite">
      {icon}
      {text}
    </p>
  );
}

function DraftForm({ draft, onChange }: { draft: Draft; onChange: (d: Draft) => void }) {
  const setQ = (i: number, q: DraftQuestion) => onChange({ ...draft, questions: draft.questions.map((x, j) => (j === i ? q : x)) });
  const totalPoints = draft.questions.reduce((s, q) => s + q.points, 0);
  return (
    <div className="space-y-4">
      <Card title="Settings">
        <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
          <TextField label="Title" value={draft.title} onChange={(e) => onChange({ ...draft, title: e.target.value })} maxLength={200} />
          <TextField label="Time limit (minutes)" type="number" min={0.5} max={180} step={0.5} value={draft.minutes} onChange={(e) => onChange({ ...draft, minutes: Number(e.target.value) })} />
        </div>
        <div className="mt-3">
          <Field label="Instructions (optional)">
            <Textarea rows={2} value={draft.description} onChange={(e) => onChange({ ...draft, description: e.target.value })} maxLength={2000} />
          </Field>
        </div>
      </Card>

      {draft.questions.map((q, i) => (
        <Card
          key={i}
          title={`Question ${i + 1}`}
          actions={
            <>
              <label className="flex items-center gap-1.5 text-sm text-muted">
                Points
                <Input type="number" min={1} max={100} className="h-8 w-16" value={q.points} onChange={(e) => setQ(i, { ...q, points: Math.max(1, Math.min(100, Number(e.target.value) || 1)) })} />
              </label>
              <Button size="sm" variant="ghost" aria-label={`Delete question ${i + 1}`} onClick={() => onChange({ ...draft, questions: draft.questions.filter((_, j) => j !== i) })}>
                <Trash2 className="size-4" />
              </Button>
            </>
          }
        >
          <Textarea rows={2} placeholder="Question text" value={q.text} onChange={(e) => setQ(i, { ...q, text: e.target.value })} aria-label={`Question ${i + 1} text`} />
          <p className="mb-2 mt-3 text-xs text-muted">Options: pick the one correct answer.</p>
          <ul className="space-y-2">
            {q.options.map((o, oi) => (
              <li key={oi} className="flex items-center gap-2">
                <input
                  type="radio"
                  name={`correct-${i}`}
                  checked={o.isCorrect}
                  onChange={() => setQ(i, { ...q, options: q.options.map((x, k) => ({ ...x, isCorrect: k === oi })) })}
                  className="size-4 accent-good"
                  aria-label={`Option ${oi + 1} is correct`}
                />
                <Input
                  placeholder={`Option ${oi + 1}`}
                  value={o.text}
                  onChange={(e) => setQ(i, { ...q, options: q.options.map((x, k) => (k === oi ? { ...x, text: e.target.value } : x)) })}
                  className={o.isCorrect ? "border-good/50" : undefined}
                />
                <button
                  disabled={q.options.length <= 2}
                  onClick={() => {
                    const options = q.options.filter((_, k) => k !== oi);
                    if (o.isCorrect) options[0] = { ...options[0], isCorrect: true };
                    setQ(i, { ...q, options });
                  }}
                  className="rounded p-1.5 text-muted hover:bg-canvas hover:text-ink disabled:invisible"
                  aria-label={`Remove option ${oi + 1}`}
                >
                  <X className="size-4" />
                </button>
              </li>
            ))}
          </ul>
          {q.options.length < 6 && (
            <Button size="sm" variant="ghost" className="mt-2" onClick={() => setQ(i, { ...q, options: [...q.options, { text: "", isCorrect: false }] })}>
              <Plus className="size-4" /> Add option
            </Button>
          )}
        </Card>
      ))}

      <div className="flex items-center justify-between">
        <Button variant="secondary" onClick={() => onChange({ ...draft, questions: [...draft.questions, blankQuestion()] })}>
          <Plus className="size-4" /> Add question
        </Button>
        <p className="text-sm text-muted">
          {draft.questions.length} question{draft.questions.length === 1 ? "" : "s"} · {totalPoints} point{totalPoints === 1 ? "" : "s"}
        </p>
      </div>
    </div>
  );
}

type PublishedTab = "attempts" | "leaderboard" | "questions";

function PublishedQuiz({ quiz }: { quiz: FullQuiz }) {
  const [tab, setTab] = useState<PublishedTab>("attempts");
  const attempts = useQuery({ queryKey: ["attempts", quiz.id], queryFn: () => api.get<{ items: Attempt[] }>(`/quizzes/${quiz.id}/attempts`).then((r) => r.items) });
  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {quiz.title} <Badge tone="good">Published</Badge>
          </span>
        }
        subtitle={`${quiz.batch.name} · ${quiz.questions.length} questions · ${fmtSeconds(quiz.durationSeconds)} · by ${quiz.createdBy.name}`}
      />
      <Tabs<PublishedTab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "attempts", label: `Attempts (${quiz._count.attempts})` },
          { id: "leaderboard", label: "Leaderboard" },
          { id: "questions", label: "Questions" },
        ]}
      />
      {tab === "attempts" && (
        <Card padded={false}>
          <QueryState query={attempts}>
            {(items) =>
              items.length === 0 ? (
                <EmptyState title="No one has started it yet" />
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <Th>Student</Th>
                      <Th>Status</Th>
                      <Th className="text-right">Score</Th>
                      <Th className="text-right">Time</Th>
                      <Th>Submitted</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((a) => (
                      <tr key={a.id}>
                        <Td>
                          <div className="font-medium">{a.student.name}</div>
                          <div className="text-xs text-muted">{a.student.email}</div>
                        </Td>
                        <Td>
                          <Badge tone={a.status === "SUBMITTED" ? "good" : a.status === "EXPIRED" ? "bad" : "warn"}>{a.status === "IN_PROGRESS" ? "In progress" : a.status.toLowerCase()}</Badge>
                        </Td>
                        <Td className="text-right tabular-nums">{a.status === "IN_PROGRESS" ? "—" : `${a.score}/${a.maxScore}`}</Td>
                        <Td className="text-right tabular-nums text-muted">{fmtDuration(a.timeTakenMs)}</Td>
                        <Td className="text-muted">{fmtDateTime(a.submittedAt)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )
            }
          </QueryState>
        </Card>
      )}
      {tab === "leaderboard" && (
        <Card padded={false}>
          <QuizLeaderboardTable quizId={quiz.id} />
        </Card>
      )}
      {tab === "questions" && (
        <div className="space-y-3">
          {quiz.description && <p className="text-sm text-muted">{quiz.description}</p>}
          {quiz.questions.map((q, i) => (
            <Card key={q.id} title={`${i + 1}. ${q.text}`} actions={<span className="text-xs text-muted">{q.points} pt</span>}>
              <ul className="space-y-1.5">
                {q.options.map((o) => (
                  <li key={o.id} className={cx("flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm", o.isCorrect ? "bg-good-soft font-medium text-good" : "text-muted")}>
                    {o.isCorrect ? <Check className="size-4" /> : <span className="size-4" />} {o.text}
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
