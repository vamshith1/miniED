import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Timer } from "lucide-react";
import { ApiError, api } from "../../lib/api";
import type { StartedAttempt } from "../../lib/types";
import { Button, Card, ErrorBox, Spinner, cx } from "../../components/ui";

// Answers are kept in sessionStorage so a reload doesn't lose them.
// The timer itself is the server's: expiresAt comes from startedAt.
const storeKey = (attemptId: string) => `miniedcrm.answers.${attemptId}`;
const loadAnswers = (attemptId: string): Record<string, string> => {
  try {
    return JSON.parse(sessionStorage.getItem(storeKey(attemptId)) ?? "{}");
  } catch {
    return {};
  }
};

function useCountdown(expiresAt: string | undefined) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  return expiresAt ? Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 1000)) : null;
}

export function TakeQuizPage() {
  const { id } = useParams() as { id: string };
  // POST /start is safe to repeat: it resumes the same attempt.
  const start = useQuery({
    queryKey: ["attempt", id],
    queryFn: () => api.post<StartedAttempt>(`/quizzes/${id}/start`),
    staleTime: Infinity,
    gcTime: 0,
  });

  if (start.isPending) return <Spinner label="Starting the quiz…" />;
  if (start.error) {
    const done = start.error instanceof ApiError && start.error.status === 409;
    return (
      <Card>
        <div className="space-y-3 text-center">
          <ErrorBox error={start.error} />
          {done && (
            <Link to={`/quizzes/${id}/result`}>
              <Button>See your result</Button>
            </Link>
          )}
          <Link to="/home" className="block text-sm text-muted hover:text-ink">
            Back to home
          </Link>
        </div>
      </Card>
    );
  }
  return <Attempt attempt={start.data} />;
}

function Attempt({ attempt }: { attempt: StartedAttempt }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [answers, setAnswers] = useState<Record<string, string>>(() => loadAnswers(attempt.attemptId));
  const remaining = useCountdown(attempt.expiresAt);
  const answered = Object.keys(answers).length;
  const total = attempt.questions.length;
  const autoSubmitted = useRef(false);

  useEffect(() => {
    try {
      sessionStorage.setItem(storeKey(attempt.attemptId), JSON.stringify(answers));
    } catch {
      /* storage unavailable: answers still live in memory */
    }
  }, [answers, attempt.attemptId]);

  const submit = useMutation({
    mutationFn: () =>
      api.post(`/quizzes/${attempt.quiz.id}/submit`, {
        answers: attempt.questions.map((q) => ({ questionId: q.id, optionId: answers[q.id] ?? null })),
      }),
    onSettled: (_d, err) => {
      // Submitted, or the server says it's already done/expired: either way show the result.
      if (!err || (err instanceof ApiError && err.status === 409)) {
        try {
          sessionStorage.removeItem(storeKey(attempt.attemptId));
        } catch {
          /* ignore */
        }
        qc.invalidateQueries({ queryKey: ["quizzes", "mine"] });
        qc.invalidateQueries({ queryKey: ["leaderboard"] }); // the new score changes the rankings
        navigate(`/quizzes/${attempt.quiz.id}/result`, { replace: true });
      }
    },
  });
  const doSubmit = useCallback(() => submit.mutate(), [submit]);

  // Time's up: submit what's there. The server allows 15 s of grace for this.
  useEffect(() => {
    if (remaining === 0 && !autoSubmitted.current && !submit.isPending) {
      autoSubmitted.current = true;
      doSubmit();
    }
  }, [remaining, submit.isPending, doSubmit]);

  // Warn before leaving mid-quiz (the timer keeps running).
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const mins = remaining !== null ? Math.floor(remaining / 60) : 0;
  const secs = remaining !== null ? remaining % 60 : 0;
  const low = remaining !== null && remaining <= 60;

  return (
    <>
      <Link to="/home" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Home (the timer keeps running)
      </Link>

      {/* Sticky bar so the time and progress are always visible */}
      <div className="sticky top-14 z-10 mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface px-4 py-3 shadow-sm md:top-2">
        <div className="min-w-0">
          <h1 className="truncate font-semibold">{attempt.quiz.title}</h1>
          <p className="text-xs text-muted">
            {answered} of {total} answered
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span role="timer" aria-live="off" className={cx("flex items-center gap-1.5 rounded-md px-2.5 py-1 font-mono text-lg font-semibold tabular-nums", low ? "bg-bad-soft text-bad" : "bg-canvas text-ink")}>
            <Timer className="size-4" />
            {mins}:{String(secs).padStart(2, "0")}
          </span>
          <Button
            loading={submit.isPending}
            onClick={() => (answered === total || confirm(`${total - answered} question(s) unanswered. They'll count as wrong. Submit anyway?`)) && doSubmit()}
          >
            Submit
          </Button>
        </div>
      </div>

      {low && remaining! > 0 && (
        <p className="mb-3 flex items-center gap-1.5 text-sm font-medium text-bad" role="alert">
          <AlertTriangle className="size-4" /> Less than a minute left. It submits automatically at 0:00.
        </p>
      )}
      {attempt.quiz.description && <p className="mb-4 text-sm text-muted">{attempt.quiz.description}</p>}
      <ErrorBox error={submit.error instanceof ApiError && submit.error.status === 409 ? null : submit.error} />

      <ol className="space-y-3">
        {attempt.questions.map((q, i) => (
          <li key={q.id}>
            <Card>
              <fieldset>
                <legend className="mb-3 flex w-full justify-between gap-3 font-medium">
                  <span>
                    {i + 1}. {q.text}
                  </span>
                  <span className="shrink-0 text-xs font-normal text-muted">
                    {q.points} pt{q.points === 1 ? "" : "s"}
                  </span>
                </legend>
                <div className="space-y-2">
                  {q.options.map((o) => (
                    <label
                      key={o.id}
                      className={cx(
                        "flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm",
                        answers[q.id] === o.id ? "border-brand bg-brand-soft" : "border-line hover:bg-canvas",
                      )}
                    >
                      <input type="radio" name={q.id} checked={answers[q.id] === o.id} onChange={() => setAnswers({ ...answers, [q.id]: o.id })} className="size-4 accent-brand" disabled={remaining === 0} />
                      {o.text}
                    </label>
                  ))}
                </div>
              </fieldset>
            </Card>
          </li>
        ))}
      </ol>
    </>
  );
}
