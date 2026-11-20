import { useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, RotateCcw, Dumbbell } from "lucide-react";
import { api } from "../../lib/api";
import { fmtDateTime, fmtDuration, fmtPct } from "../../lib/format";
import type { PracticeRun, PracticeSession, QuizResult } from "../../lib/types";
import { Badge, Button, Card, ErrorBox, PageHeader, QueryState, Table, Td, Th, askConfirm } from "../../components/ui";
import { AnswerReview, QuestionList, ResultStats, RulesNote, fmtScore } from "../../components/Quiz";

/**
 * Practice: no server timer, no leaderboard, as many goes as you like.
 * After each go the answers and explanations show straight away.
 */
export function PracticeQuizPage() {
  const { id } = useParams() as { id: string };
  const session = useQuery({ queryKey: ["practice", id], queryFn: () => api.get<PracticeSession>(`/quizzes/${id}/practice`) });
  return (
    <>
      <Link to="/home" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Home
      </Link>
      <QueryState query={session}>{(s) => <Practice session={s} />}</QueryState>
    </>
  );
}

function Practice({ session }: { session: PracticeSession }) {
  const qc = useQueryClient();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<QuizResult | null>(null);
  const startedAt = useRef(Date.now());
  const runs = result?.runs ?? session.runs;
  const answered = Object.keys(answers).length;
  const total = session.questions.length;

  const submit = useMutation({
    mutationFn: () =>
      api.post<QuizResult>(`/quizzes/${session.quiz.id}/practice`, {
        answers: session.questions.map((q) => ({ questionId: q.id, optionId: answers[q.id] ?? null })),
        timeTakenMs: Date.now() - startedAt.current,
      }),
    onSuccess: (r) => {
      setResult(r);
      qc.invalidateQueries({ queryKey: ["quizzes", "mine"] });
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
  });

  const again = () => {
    setAnswers({});
    setResult(null);
    startedAt.current = Date.now();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {session.quiz.title} <Badge tone="brand"><Dumbbell className="mr-1 size-3.5" /> Practice</Badge>
          </span>
        }
        subtitle={session.quiz.description ?? undefined}
        actions={
          result ? (
            <Button onClick={again}>
              <RotateCcw className="size-4" /> Try again
            </Button>
          ) : (
            <Button
              loading={submit.isPending}
              disabled={total === 0}
              onClick={async () =>
                (answered === total || (await askConfirm(`${total - answered} question(s) unanswered. They count as skipped. Check your answers anyway?`, { confirmLabel: "Check answers" }))) &&
                submit.mutate()
              }
            >
              Check answers
            </Button>
          )
        }
      />
      <RulesNote rules={session.quiz} className="mb-4" />
      <ErrorBox error={submit.error} />

      {result ? (
        <>
          <ResultStats r={result} />
          <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
            <AnswerReview review={result.review} negativePercent={result.negativePercent} />
            <RunHistory runs={runs} />
          </div>
        </>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
          <div>
            <p className="mb-3 text-xs text-muted">
              {answered} of {total} answered
            </p>
            <QuestionList questions={session.questions} answers={answers} onChange={setAnswers} negativePercent={session.quiz.negativePercent} />
          </div>
          <RunHistory runs={runs} />
        </div>
      )}
    </>
  );
}

function RunHistory({ runs }: { runs: PracticeRun[] }) {
  return (
    <Card title={`Your goes (${runs.length})`} padded={false} className="self-start">
      {runs.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted">Your first go shows up here. Practice as often as you like.</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>When</Th>
              <Th className="text-right">Score</Th>
              <Th className="text-right">Time</Th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <Td className="text-muted">{fmtDateTime(r.createdAt)}</Td>
                <Td className="text-right tabular-nums">
                  {fmtScore(r.score)}/{r.maxScore} <span className="text-xs text-muted">({fmtPct(r.maxScore ? (r.score / r.maxScore) * 100 : 0)})</span>
                </Td>
                <Td className="text-right tabular-nums text-muted">{fmtDuration(r.timeTakenMs)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
