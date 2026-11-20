import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Award, BarChart3, Clock, Crosshair, Medal, Target, TrendingDown, TrendingUp } from "lucide-react";
import { api } from "../../lib/api";
import { fmtDate, fmtDuration, fmtPct } from "../../lib/format";
import type { QuizHistory, QuizHistoryItem, SkillReport } from "../../lib/types";
import { AnimatedNumber, Badge, Card, EmptyState, PageHeader, QueryState, Stat, Table, Td, Th, cx } from "../../components/ui";
import { AXIS_TEXT, ChartTooltip, GRID, SERIES_1, SERIES_2, SeriesLegend, TICK } from "../../components/charts";
import { SkillBars, fmtScore } from "../../components/Quiz";

const pctFmt = (n: number) => `${Math.round(n * 10) / 10}%`;
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;

// How this attempt compares with the class average on the same quiz.
function VsClass({ item }: { item: QuizHistoryItem }) {
  if (item.classAverage === null || item.status === "EXPIRED") return <span className="text-faint">—</span>;
  const diff = Math.round((item.percentage - item.classAverage) * 10) / 10;
  if (diff === 0) return <span className="text-muted">same as class</span>;
  const up = diff > 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className={cx("inline-flex items-center gap-1 tabular-nums", up ? "text-good" : "text-bad")}>
      <Icon className="size-3.5" />
      {up ? "+" : ""}
      {diff}
      <span className="text-xs text-faint">vs {fmtPct(item.classAverage)}</span>
    </span>
  );
}

export function MyQuizzesPage() {
  const history = useQuery({ queryKey: ["progress", "quizzes"], queryFn: () => api.get<QuizHistory>("/progress/quizzes") });
  const skills = useQuery({ queryKey: ["progress", "skills"], queryFn: () => api.get<SkillReport>("/progress/skills") });

  return (
    <>
      <PageHeader title="My quizzes" subtitle="Every quiz you've taken: your marks, your place in the class, and how you're trending." />
      <QueryState query={history}>
        {({ summary, items }) => {
          if (items.length === 0) {
            return (
              <Card>
                <EmptyState title="No quizzes taken yet">When you finish a quiz, its marks show up here.</EmptyState>
              </Card>
            );
          }
          // Oldest first for the chart, labelled by quiz.
          const trend = [...items].reverse().map((i, n) => ({
            label: `${n + 1}. ${i.title.length > 14 ? `${i.title.slice(0, 13)}…` : i.title}`,
            title: i.title,
            You: i.percentage,
            "Class average": i.classAverage,
          }));
          return (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <div className="animate-fade-up">
                  <Stat label="Average" icon={<Target className="size-4" />} value={<AnimatedNumber value={summary.averagePercentage} format={pctFmt} />} hint={`Across ${summary.taken} quiz${summary.taken === 1 ? "" : "zes"}`} />
                </div>
                <div className="animate-fade-up" style={{ animationDelay: "50ms" }}>
                  <Stat label="Best score" icon={<Award className="size-4" />} tone="good" value={<AnimatedNumber value={summary.bestPercentage} format={pctFmt} />} hint={`Latest: ${fmtPct(summary.latestPercentage)}`} />
                </div>
                <div className="animate-fade-up" style={{ animationDelay: "100ms" }}>
                  <Stat label="First places" icon={<Medal className="size-4" />} value={<AnimatedNumber value={summary.firstPlaces} />} hint="Quizzes where you ranked #1" />
                </div>
                <div className="animate-fade-up" style={{ animationDelay: "150ms" }}>
                  <Stat label="Time on quizzes" icon={<Clock className="size-4" />} value={fmtDuration(summary.totalTimeMs)} hint="Total time answering" />
                </div>
              </div>

              <div className="animate-fade-up" style={{ animationDelay: "200ms" }}>
                <Card
                  title={
                    <span className="flex items-center gap-2">
                      <BarChart3 className="size-4 text-brand-strong" /> Your scores over time
                    </span>
                  }
                >
                  <div style={{ height: 260 }}>
                    <ResponsiveContainer>
                      <LineChart data={trend} margin={{ top: 8, right: 16, left: -12, bottom: 0 }}>
                        <CartesianGrid vertical={false} stroke={GRID} />
                        <XAxis dataKey="label" tick={TICK} tickLine={false} axisLine={{ stroke: GRID }} interval="preserveStartEnd" />
                        <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={TICK} tickLine={false} axisLine={false} />
                        <ReferenceLine y={summary.averagePercentage ?? 0} stroke={AXIS_TEXT} strokeDasharray="4 4" label={{ value: "your average", position: "insideTopRight", fill: AXIS_TEXT, fontSize: 11 }} />
                        <Tooltip isAnimationActive={false} content={<ChartTooltip format={(v) => fmtPct(v)} />} />
                        <Legend content={<SeriesLegend items={[{ name: "You", color: SERIES_1 }, { name: "Class average", color: SERIES_2 }]} />} />
                        <Line type="monotone" dataKey="You" stroke={SERIES_1} strokeWidth={2.5} dot={{ r: 4, fill: SERIES_1 }} activeDot={{ r: 6 }} animationDuration={800} />
                        <Line type="monotone" dataKey="Class average" stroke={SERIES_2} strokeWidth={1.5} strokeDasharray="5 4" dot={{ r: 3, fill: SERIES_2 }} connectNulls animationDuration={800} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </Card>
              </div>

              <div className="animate-fade-up" style={{ animationDelay: "225ms" }}>
                <Card
                  title={
                    <span className="flex items-center gap-2">
                      <Crosshair className="size-4 text-brand-strong" /> Skills: where to focus
                    </span>
                  }
                >
                  <QueryState query={skills}>
                    {(r) => (
                      <>
                        {r.gaps.length > 0 ? (
                          <p className="mb-3 text-sm">
                            Work on <strong>{r.gaps.join(", ")}</strong>: under half your answers there were right. Ask your mentor for a practice quiz on {r.gaps.length === 1 ? "it" : "them"}.
                          </p>
                        ) : r.skills.length > 0 ? (
                          <p className="mb-3 text-sm text-good">No skill gaps right now: every skill is at 50% or better.</p>
                        ) : null}
                        <SkillBars skills={r.skills} empty="Skills show up once your tests have questions tagged with one." />
                      </>
                    )}
                  </QueryState>
                </Card>
              </div>

              <div className="animate-fade-up" style={{ animationDelay: "250ms" }}>
                <Card title="Every attempt" padded={false}>
                  <Table>
                    <thead>
                      <tr>
                        <Th>Quiz</Th>
                        <Th>Date</Th>
                        <Th className="text-right">Marks</Th>
                        <Th>Rank</Th>
                        <Th>Vs class</Th>
                        <Th>Time</Th>
                        <Th>
                          <span className="sr-only">Review</span>
                        </Th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((i) => (
                        <tr key={i.attemptId}>
                          <Td>
                            <div className="font-medium">{i.title}</div>
                            <div className="text-xs text-muted">{i.batchName}</div>
                          </Td>
                          <Td className="whitespace-nowrap text-muted">{fmtDate(i.takenAt)}</Td>
                          <Td className="whitespace-nowrap text-right">
                            <div className="font-semibold tabular-nums">
                              {fmtScore(i.score)}/{i.maxScore}
                            </div>
                            <div className={cx("text-xs tabular-nums", i.percentage >= 75 ? "text-good" : i.percentage < 40 ? "text-bad" : "text-muted")}>{fmtPct(i.percentage)}</div>
                          </Td>
                          <Td className="whitespace-nowrap">
                            {i.status === "EXPIRED" ? (
                              <Badge tone="bad">Time ran out</Badge>
                            ) : i.passed === false ? (
                              <span className="inline-flex flex-col">
                                <Badge tone="bad">Not passed</Badge>
                                {i.rank && <span className="mt-0.5 text-xs text-muted">{ordinal(i.rank)} of {i.outOf}</span>}
                              </span>
                            ) : i.rank ? (
                              <span className="inline-flex items-center gap-1.5">
                                {i.rank === 1 && <Medal className="size-4 text-warn" />}
                                <span className="font-medium">{ordinal(i.rank)}</span>
                                <span className="text-xs text-muted">of {i.outOf}</span>
                              </span>
                            ) : (
                              "—"
                            )}
                          </Td>
                          <Td className="whitespace-nowrap">
                            <VsClass item={i} />
                          </Td>
                          <Td className="whitespace-nowrap text-muted">
                            {fmtDuration(i.timeTakenMs)}
                            <span className="text-xs text-faint"> / {Math.round(i.durationSeconds / 60)} min</span>
                          </Td>
                          <Td className="text-right">
                            <Link to={`/quizzes/${i.quizId}/result`} className="whitespace-nowrap rounded-md px-2 py-1 text-sm font-medium text-brand-strong transition-colors hover:bg-brand-soft">
                              Review →
                            </Link>
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </Card>
              </div>
            </div>
          );
        }}
      </QueryState>
    </>
  );
}
