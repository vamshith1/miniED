import { useQuery } from "@tanstack/react-query";
import { Trophy } from "lucide-react";
import { api } from "../lib/api";
import { fmtDuration, fmtPct, relative } from "../lib/format";
import type { BatchLeaderboard, QuizLeaderboard } from "../lib/types";
import { EmptyState, QueryState, Table, Td, Th, cx } from "./ui";

const medal = (rank: number) => (rank === 1 ? "text-amber-500" : rank === 2 ? "text-slate-400" : rank === 3 ? "text-orange-700" : "text-transparent");

function RankCell({ rank }: { rank: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-semibold tabular-nums">
      <Trophy className={cx("size-4", medal(rank))} aria-hidden />
      {rank}
    </span>
  );
}

// `meId` highlights the viewer's own row.
export function BatchLeaderboardTable({ batchId, meId }: { batchId: string; meId?: string }) {
  const lb = useQuery({ queryKey: ["leaderboard", "batch", batchId], queryFn: () => api.get<BatchLeaderboard>(`/batches/${batchId}/leaderboard`) });
  return (
    <QueryState query={lb}>
      {(data) =>
        data.entries.length === 0 ? (
          <EmptyState title="No scores yet">The leaderboard fills in as students submit quizzes.</EmptyState>
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Rank</Th>
                  <Th>Student</Th>
                  <Th className="text-right">Total score</Th>
                  <Th className="text-right">Quizzes</Th>
                  <Th className="text-right">Total time</Th>
                </tr>
              </thead>
              <tbody>
                {data.entries.map((e) => (
                  <tr key={e.studentId} className={e.studentId === meId ? "bg-brand-soft/60" : undefined}>
                    <Td><RankCell rank={e.rank} /></Td>
                    <Td className="font-medium">{e.name}{e.studentId === meId && <span className="ml-1.5 text-xs text-brand">(you)</span>}</Td>
                    <Td className="text-right tabular-nums">
                      {e.totalScore}/{e.maxScore} <span className="text-muted">· {fmtPct(e.percentage)}</span>
                    </Td>
                    <Td className="text-right tabular-nums">{e.quizzesTaken}</Td>
                    <Td className="text-right tabular-nums text-muted">{fmtDuration(e.totalTimeMs)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <p className="px-4 py-2 text-xs text-faint">Ties on score are broken by less total time. Updated {relative(data.generatedAt)}.</p>
          </>
        )
      }
    </QueryState>
  );
}

export function QuizLeaderboardTable({ quizId, meId }: { quizId: string; meId?: string }) {
  const lb = useQuery({ queryKey: ["leaderboard", "quiz", quizId], queryFn: () => api.get<QuizLeaderboard>(`/quizzes/${quizId}/leaderboard`) });
  return (
    <QueryState query={lb}>
      {(data) =>
        data.entries.length === 0 ? (
          <EmptyState title="No submissions yet" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Rank</Th>
                <Th>Student</Th>
                <Th className="text-right">Score</Th>
                <Th className="text-right">Time</Th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((e) => (
                <tr key={e.studentId} className={e.studentId === meId ? "bg-brand-soft/60" : undefined}>
                  <Td><RankCell rank={e.rank} /></Td>
                  <Td className="font-medium">{e.name}{e.studentId === meId && <span className="ml-1.5 text-xs text-brand">(you)</span>}</Td>
                  <Td className="text-right tabular-nums">
                    {e.score}/{e.maxScore} <span className="text-muted">· {fmtPct(e.percentage)}</span>
                  </Td>
                  <Td className="text-right tabular-nums text-muted">{fmtDuration(e.timeTakenMs)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )
      }
    </QueryState>
  );
}
