import { Link, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Check, X } from "lucide-react";
import { api } from "../../lib/api";
import { useUser } from "../../lib/auth";
import { fmtDuration, fmtPct } from "../../lib/format";
import type { QuizResult } from "../../lib/types";
import { Badge, Card, PageHeader, QueryState, Stat, cx } from "../../components/ui";
import { QuizLeaderboardTable } from "../../components/Leaderboards";

export function QuizResultPage() {
  const { id } = useParams() as { id: string };
  const user = useUser();
  const result = useQuery({ queryKey: ["result", id], queryFn: () => api.get<QuizResult>(`/quizzes/${id}/result`) });

  return (
    <>
      <Link to="/home" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Home
      </Link>
      <QueryState query={result}>
        {(r) => (
          <>
            <PageHeader title="Your result" subtitle={r.status === "EXPIRED" ? "Time ran out before this was submitted, so it scores 0." : undefined} />
            <div className="mb-4 grid gap-3 sm:grid-cols-3">
              <Stat label="Score" value={`${r.score}/${r.maxScore}`} tone={r.status === "EXPIRED" ? "bad" : undefined} />
              <Stat label="Percentage" value={fmtPct(r.percentage)} />
              <Stat label="Time taken" value={fmtDuration(r.timeTakenMs)} />
            </div>

            <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
              <div className="space-y-3">
                <h2 className="text-sm font-semibold">Answer review</h2>
                {r.review.map((q, i) => (
                  <Card
                    key={q.questionId}
                    title={
                      <span className="flex items-start gap-2">
                        {q.correct ? <Check className="mt-0.5 size-4 shrink-0 text-good" aria-label="Correct" /> : <X className="mt-0.5 size-4 shrink-0 text-bad" aria-label="Wrong" />}
                        {i + 1}. {q.text}
                      </span>
                    }
                    actions={<span className="text-xs text-muted">{q.correct ? `+${q.points}` : 0} / {q.points}</span>}
                  >
                    <ul className="space-y-1.5">
                      {q.options.map((o) => {
                        const mine = o.id === q.yourOptionId;
                        return (
                          <li
                            key={o.id}
                            className={cx(
                              "flex items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-sm",
                              o.isCorrect ? "border-good/40 bg-good-soft" : mine ? "border-bad/40 bg-bad-soft" : "border-transparent text-muted",
                            )}
                          >
                            {o.text}
                            <span className="flex gap-1">
                              {mine && <Badge tone={o.isCorrect ? "good" : "bad"}>Your answer</Badge>}
                              {o.isCorrect && <Badge tone="good">Correct</Badge>}
                            </span>
                          </li>
                        );
                      })}
                      {!q.yourOptionId && <li className="text-xs text-bad">You didn't answer this one.</li>}
                    </ul>
                  </Card>
                ))}
              </div>
              <Card title="Leaderboard" padded={false} className="self-start">
                <QuizLeaderboardTable quizId={id} meId={user.id} />
              </Card>
            </div>
          </>
        )}
      </QueryState>
    </>
  );
}
