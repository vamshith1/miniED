import { Link, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { api } from "../../lib/api";
import { useUser } from "../../lib/auth";
import type { QuizResult } from "../../lib/types";
import { Card, PageHeader, QueryState } from "../../components/ui";
import { QuizLeaderboardTable } from "../../components/Leaderboards";
import { AnswerReview, ResultStats } from "../../components/Quiz";

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
            <ResultStats r={r} />
            {r.isHiringTest ? (
              <AnswerReview review={r.review} negativePercent={r.negativePercent} />
            ) : (
              <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
                <AnswerReview review={r.review} negativePercent={r.negativePercent} />
                <Card title="Leaderboard" padded={false} className="self-start">
                  <QuizLeaderboardTable quizId={id} meId={user.id} />
                </Card>
              </div>
            )}
          </>
        )}
      </QueryState>
    </>
  );
}
