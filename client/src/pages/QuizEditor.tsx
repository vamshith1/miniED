import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Plus, Send, Trash2, X } from "lucide-react";
import { api } from "../lib/api";
import { fmtDateTime, fmtDuration, fmtSeconds } from "../lib/format";
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

function NewQuiz() {
  const [params] = useSearchParams();
  const batchId = params.get("batchId") ?? "";
  const navigate = useNavigate();
  const qc = useQueryClient();
  const batch = useQuery({ queryKey: ["batch", batchId], queryFn: () => api.get<{ batch: Batch }>(`/batches/${batchId}`).then((r) => r.batch), enabled: !!batchId });
  const [draft, setDraft] = useState<Draft>({ title: "", description: "", minutes: 10, questions: [blankQuestion()] });
  const create = useMutation({
    mutationFn: () => api.post<{ quiz: FullQuiz }>("/quizzes", { batchId, ...toBody(draft) }),
    onSuccess: ({ quiz }) => {
      qc.invalidateQueries({ queryKey: ["quizzes", batchId] });
      navigate(`/quizzes/${quiz.id}`, { replace: true });
    },
  });
  if (!batchId) return <EmptyState title="Open a batch first">Quizzes are created from a batch's Quizzes tab.</EmptyState>;
  const issues = problems(draft);
  return (
    <>
      <BackToBatch batchId={batchId} />
      <PageHeader title="New quiz" subtitle={batch.data ? `For ${batch.data.name}. It stays a draft, hidden from students, until you publish it.` : undefined} />
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

function BackToBatch({ batchId }: { batchId: string }) {
  return (
    <Link to={`/batches/${batchId}?tab=quizzes`} className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
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
          <BackToBatch batchId={q.batch.id} />
          {q.isPublished ? <PublishedQuiz quiz={q} /> : <DraftQuiz key={q.id} quiz={q} />}
        </>
      )}
    </QueryState>
  );
}

function DraftQuiz({ quiz }: { quiz: FullQuiz }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [draft, setDraft] = useState(() => toDraft(quiz));
  const [savedJson, setSavedJson] = useState(() => JSON.stringify(toDraft(quiz)));
  const dirty = JSON.stringify(draft) !== savedJson;
  const issues = problems(draft);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["quiz", quiz.id] });
    qc.invalidateQueries({ queryKey: ["quizzes", quiz.batch.id] });
  };

  const save = useMutation({
    mutationFn: () => api.put(`/quizzes/${quiz.id}`, toBody(draft)),
    onSuccess: () => setSavedJson(JSON.stringify(draft)),
  });
  const publish = useMutation({
    mutationFn: async () => {
      if (dirty) await api.put(`/quizzes/${quiz.id}`, toBody(draft));
      return api.post(`/quizzes/${quiz.id}/publish`);
    },
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/quizzes/${quiz.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["quizzes", quiz.batch.id] });
      navigate(`/batches/${quiz.batch.id}?tab=quizzes`);
    },
  });

  return (
    <>
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
            <Button variant="secondary" disabled={!dirty || issues.length > 0} loading={save.isPending} onClick={() => save.mutate()}>
              {dirty ? "Save draft" : "Saved"}
            </Button>
            <Button
              disabled={issues.length > 0 || draft.questions.length === 0}
              loading={publish.isPending}
              onClick={async () => (await askConfirm("Publish to students? You won't be able to edit it afterwards.", { confirmLabel: "Publish" })) && publish.mutate()}
            >
              <Send className="size-4" /> Publish
            </Button>
          </>
        }
      />
      <div className="mb-3 space-y-2">
        <ErrorBox error={save.error ?? publish.error ?? remove.error} />
        {issues.length > 0 && <p className="text-sm text-warn">{issues[0]}</p>}
      </div>
      <DraftForm draft={draft} onChange={setDraft} />
    </>
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
