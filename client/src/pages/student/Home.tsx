import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Clock, Dumbbell, FileText, Timer } from "lucide-react";
import { api } from "../../lib/api";
import { useUser } from "../../lib/auth";
import { fmtDay, fmtPct, fmtSeconds } from "../../lib/format";
import type { Batch, MyAttendance, StudentQuiz } from "../../lib/types";
import { Badge, Button, Card, EmptyState, PageHeader, QueryState, Stat, cx } from "../../components/ui";
import { BatchLeaderboardTable } from "../../components/Leaderboards";
import { fmtScore } from "../../components/Quiz";

const dot: Record<string, string> = { PRESENT: "bg-good", LATE: "bg-warn", ABSENT: "bg-bad" };

export function StudentHomePage() {
  const user = useUser();
  const batch = useQuery({
    queryKey: ["batch", user.batchId],
    queryFn: () => api.get<{ batch: Batch }>(`/batches/${user.batchId}`).then((r) => r.batch),
    enabled: !!user.batchId,
  });
  const attendance = useQuery({ queryKey: ["attendance", "me"], queryFn: () => api.get<MyAttendance>("/attendance/me") });
  const quizzes = useQuery({ queryKey: ["quizzes", "mine"], queryFn: () => api.get<{ items: StudentQuiz[] }>("/quizzes").then((r) => r.items) });

  const first = user.name.split(" ")[0];

  if (!user.batchId) {
    return (
      <>
        <PageHeader title={`Welcome, ${first}`} />
        <Card>
          <EmptyState title="You aren't in a batch yet">
            Once the institute enrolls you, your attendance, quizzes and leaderboard show up here. Meanwhile you can{" "}
            <Link to="/documents" className="font-medium text-brand hover:underline">
              upload your resume
            </Link>
            .
          </EmptyState>
        </Card>
      </>
    );
  }

  const pending = quizzes.data?.filter((q) => q.mode === "TEST" && (!q.myAttempt || q.myAttempt.status === "IN_PROGRESS")) ?? [];

  return (
    <>
      <PageHeader
        title={`Welcome, ${first}`}
        subtitle={batch.data ? `${batch.data.name} · ${batch.data.course}${batch.data.mentor ? ` · mentor ${batch.data.mentor.name}` : ""}` : undefined}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Link to="/my-attendance" className="block rounded-lg">
          <Stat
            interactive
            label="Attendance"
            value={fmtPct(attendance.data?.percentage)}
            hint={attendance.data ? `${attendance.data.present + attendance.data.late} of ${attendance.data.total} days attended · every day →` : "…"}
            tone={attendance.data?.percentage != null && attendance.data.percentage < 75 ? "bad" : undefined}
          />
        </Link>
        <Stat label="Quizzes to take" value={quizzes.data ? pending.length : "…"} hint={quizzes.data ? `${quizzes.data.length} published so far` : undefined} />
        <Link to="/my-quizzes" className="block rounded-lg">
        <Stat
          interactive
          label="Quiz average"
          value={(() => {
            const done = quizzes.data?.filter((q) => q.myAttempt && q.myAttempt.status !== "IN_PROGRESS") ?? [];
            const score = done.reduce((s, q) => s + q.myAttempt!.score, 0);
            const max = done.reduce((s, q) => s + q.myAttempt!.maxScore, 0);
            return max ? fmtPct((score / max) * 100) : "—";
          })()}
          hint="Across quizzes you've finished · all marks →"
        />
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <Card title="Quizzes" padded={false}>
          <QueryState query={quizzes}>
            {(items) =>
              items.length === 0 ? (
                <EmptyState title="No quizzes yet">Your mentor will publish them here.</EmptyState>
              ) : (
                <ul className="divide-y divide-line">
                  {items.map((q) => (
                    <li key={q.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 font-medium">
                          {q.title} {q.mode === "PRACTICE" && <Badge tone="brand">Practice</Badge>}
                        </p>
                        <p className="flex items-center gap-1 text-xs text-muted">
                          {q.mode === "PRACTICE" ? (
                            <>
                              <Dumbbell className="size-3.5" /> No time limit · {q._count.questions} questions
                            </>
                          ) : (
                            <>
                              <Timer className="size-3.5" /> {fmtSeconds(q.durationSeconds)} · {q._count.questions} questions
                            </>
                          )}
                          {q.negativePercent > 0 && <> · −{q.negativePercent}% for wrong answers</>}
                          {q.passPercent != null && <> · pass {q.passPercent}%</>}
                        </p>
                      </div>
                      <QuizAction quiz={q} />
                    </li>
                  ))}
                </ul>
              )
            }
          </QueryState>
        </Card>

        <Card title="Last 30 days">
          <QueryState query={attendance}>
            {(a) =>
              a.recent.length === 0 ? (
                <p className="text-sm text-muted">No attendance marked yet.</p>
              ) : (
                <>
                  <ul className="flex flex-wrap gap-1.5" aria-label="Recent attendance">
                    {[...a.recent].reverse().map((r) => (
                      <li key={r.date} title={`${fmtDay(r.date)}: ${r.status.toLowerCase()}`} className={cx("size-5 rounded", dot[r.status])}>
                        <span className="sr-only">
                          {fmtDay(r.date)}: {r.status.toLowerCase()}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3 flex gap-3 text-xs text-muted">
                    <span className="flex items-center gap-1"><span className="size-2.5 rounded-sm bg-good" /> Present {a.present}</span>
                    <span className="flex items-center gap-1"><span className="size-2.5 rounded-sm bg-warn" /> Late {a.late}</span>
                    <span className="flex items-center gap-1"><span className="size-2.5 rounded-sm bg-bad" /> Absent {a.absent}</span>
                  </div>
                  {a.percentage !== null && a.percentage < 75 && <p className="mt-3 text-sm text-bad">Your attendance is below 75%. Talk to your mentor.</p>}
                </>
              )
            }
          </QueryState>
          <Link to="/documents" className="mt-4 flex items-center gap-1.5 text-sm font-medium text-brand hover:underline">
            <FileText className="size-4" /> Your resume
          </Link>
        </Card>
      </div>

      <Card title="Batch leaderboard" padded={false} className="mt-4">
        <BatchLeaderboardTable batchId={user.batchId} meId={user.id} />
      </Card>
    </>
  );
}

function QuizAction({ quiz }: { quiz: StudentQuiz }) {
  if (quiz.mode === "PRACTICE")
    return (
      <div className="flex items-center gap-2">
        {quiz.myPractice && <Badge>{quiz.myPractice.runs} go{quiz.myPractice.runs === 1 ? "" : "es"} · best {fmtPct(quiz.myPractice.bestPercentage)}</Badge>}
        <Link to={`/quizzes/${quiz.id}/practice`}>
          <Button size="sm" variant={quiz.myPractice ? "secondary" : "primary"}>
            <Dumbbell className="size-4" /> {quiz.myPractice ? "Practise again" : "Practise"}
          </Button>
        </Link>
      </div>
    );
  const a = quiz.myAttempt;
  if (!a)
    return (
      <Link to={`/quizzes/${quiz.id}/take`}>
        <Button size="sm">Start</Button>
      </Link>
    );
  if (a.status === "IN_PROGRESS")
    return (
      <Link to={`/quizzes/${quiz.id}/take`}>
        <Button size="sm" variant="secondary">
          <Clock className="size-4" /> Resume
        </Button>
      </Link>
    );
  return (
    <div className="flex items-center gap-2">
      {a.status === "EXPIRED" ? (
        <Badge tone="bad">Time ran out</Badge>
      ) : (
        <Badge tone="good">
          <CheckCircle2 className="mr-1 size-3.5" /> {fmtScore(a.score)}/{a.maxScore}
        </Badge>
      )}
      <Link to={`/quizzes/${quiz.id}/result`} className="text-sm font-medium text-brand hover:underline">
        Review
      </Link>
    </div>
  );
}
