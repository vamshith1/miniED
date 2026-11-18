import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BookOpen, CalendarDays, Hourglass, Info, PenLine } from "lucide-react";
import { api } from "../../lib/api";
import { fmtDay, fmtMinutes } from "../../lib/format";
import type { TimeSpent } from "../../lib/types";
import { AnimatedNumber, Card, EmptyState, PageHeader, QueryState, Stat } from "../../components/ui";
import { CURSOR, ChartTooltip, GRID, SERIES_1, SERIES_2, SeriesLegend, TICK } from "../../components/charts";

const minutesFmt = (n: number) => fmtMinutes(n);

// A share as a whole percent, but never "0%" or "100%" for a part that isn't really zero or everything.
const sharePct = (part: number, whole: number) => {
  if (!whole) return "0%";
  const p = (part / whole) * 100;
  if (part > 0 && p < 1) return "<1%";
  if (part < whole && p > 99) return ">99%";
  return `${Math.round(p)}%`;
};

export function TimeSpentPage() {
  const time = useQuery({ queryKey: ["progress", "time"], queryFn: () => api.get<TimeSpent>("/progress/time") });

  return (
    <>
      <PageHeader title="Time spent" subtitle="How much time you've put into learning: classes attended plus time answering quizzes." />
      <QueryState query={time}>
        {({ totals, weeks, classLengthKnown }) => {
          if (totals.daysAttended === 0 && totals.quizzesTaken === 0) {
            return (
              <Card>
                <EmptyState title="Nothing to count yet">Attend a class or take a quiz, and your learning time starts adding up here.</EmptyState>
              </Card>
            );
          }
          const classShare = totals.totalMinutes && totals.classMinutes !== null ? Math.round((totals.classMinutes / totals.totalMinutes) * 100) : null;
          // Hours per week for the chart, labelled by the week's Monday.
          const chart = weeks.map((w) => ({
            label: fmtDay(w.weekStart).replace(/,? \d{4}$/, ""),
            "In class": classLengthKnown ? Math.round((w.classMinutes / 60) * 10) / 10 : 0,
            Quizzes: Math.round((w.quizMinutes / 60) * 100) / 100,
          }));
          return (
            <div className="space-y-4">
              {!classLengthKnown && (
                <div className="flex items-start gap-2 rounded-md border border-warn/30 bg-warn-soft px-3 py-2 text-sm text-warn" role="status">
                  <Info className="mt-0.5 size-4 shrink-0" />
                  <span>Your batch's class length isn't set, so class time can't be counted in hours yet. The days you attended are shown instead. Ask your institute to add it.</span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <div className="animate-fade-up">
                  <Stat
                    label="Total learning time"
                    icon={<Hourglass className="size-4" />}
                    tone="good"
                    value={<AnimatedNumber value={totals.totalMinutes} format={minutesFmt} />}
                    hint={classLengthKnown ? `About ${fmtMinutes(totals.averagePerActiveWeekMinutes)} per active week` : "Quiz time only (class length not set)"}
                  />
                </div>
                <div className="animate-fade-up" style={{ animationDelay: "50ms" }}>
                  <Stat
                    label="In class"
                    icon={<BookOpen className="size-4" />}
                    value={totals.classMinutes !== null ? <AnimatedNumber value={totals.classMinutes} format={minutesFmt} /> : `${totals.daysAttended} days`}
                    hint={`${totals.daysAttended} day${totals.daysAttended === 1 ? "" : "s"} attended${classShare !== null && totals.classMinutes !== null ? ` · ${sharePct(totals.classMinutes, totals.totalMinutes)} of your time` : ""}`}
                  />
                </div>
                <div className="animate-fade-up" style={{ animationDelay: "100ms" }}>
                  <Stat
                    label="On quizzes"
                    icon={<PenLine className="size-4" />}
                    value={<AnimatedNumber value={totals.quizMinutes} format={minutesFmt} />}
                    hint={`${totals.quizzesTaken} quiz${totals.quizzesTaken === 1 ? "" : "zes"} taken`}
                  />
                </div>
                <div className="animate-fade-up" style={{ animationDelay: "150ms" }}>
                  <Stat label="This week" icon={<CalendarDays className="size-4" />} value={<AnimatedNumber value={totals.thisWeekMinutes} format={minutesFmt} />} hint="Since Monday" />
                </div>
              </div>

              {classShare !== null && totals.totalMinutes > 0 && (
                <div className="animate-fade-up" style={{ animationDelay: "200ms" }}>
                  <Card title="Where your time went">
                    <div className="flex h-4 overflow-hidden rounded-full bg-canvas" role="img" aria-label={`${sharePct(totals.classMinutes ?? 0, totals.totalMinutes)} in class, ${sharePct(totals.quizMinutes, totals.totalMinutes)} on quizzes`}>
                      <div className="h-full transition-all duration-700" style={{ width: `${classShare}%`, background: SERIES_1 }} />
                      <div className="h-full transition-all duration-700" style={{ width: `${Math.max(100 - classShare, totals.quizMinutes > 0 ? 1 : 0)}%`, background: SERIES_2 }} />
                    </div>
                    <div className="mt-2 flex flex-wrap justify-between gap-2 text-sm">
                      <span className="flex items-center gap-1.5">
                        <span className="size-2.5 rounded-sm" style={{ background: SERIES_1 }} /> In class: {fmtMinutes(totals.classMinutes)} ({sharePct(totals.classMinutes ?? 0, totals.totalMinutes)})
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="size-2.5 rounded-sm" style={{ background: SERIES_2 }} /> Quizzes: {fmtMinutes(totals.quizMinutes)} ({sharePct(totals.quizMinutes, totals.totalMinutes)})
                      </span>
                    </div>
                  </Card>
                </div>
              )}

              <div className="animate-fade-up" style={{ animationDelay: "250ms" }}>
                <Card
                  title={
                    <span>
                      Hours per week<span className="ml-2 font-normal text-muted">last 12 weeks</span>
                    </span>
                  }
                >
                  <div style={{ height: 280 }}>
                    <ResponsiveContainer>
                      <BarChart data={chart} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                        <CartesianGrid vertical={false} stroke={GRID} />
                        <XAxis dataKey="label" tick={TICK} tickLine={false} axisLine={{ stroke: GRID }} interval="preserveStartEnd" />
                        <YAxis tick={TICK} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}h`} allowDecimals />
                        <Tooltip isAnimationActive={false} cursor={{ fill: CURSOR }} content={<ChartTooltip format={(v) => fmtMinutes(v * 60)} />} />
                        <Legend content={<SeriesLegend items={[...(classLengthKnown ? [{ name: "In class", color: SERIES_1 }] : []), { name: "Quizzes", color: SERIES_2 }]} />} />
                        {classLengthKnown && <Bar dataKey="In class" stackId="t" fill={SERIES_1} maxBarSize={28} animationDuration={700} />}
                        <Bar dataKey="Quizzes" stackId="t" fill={SERIES_2} radius={[4, 4, 0, 0]} maxBarSize={28} animationDuration={700} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="mt-2 text-xs text-faint">
                    Class time counts each day you were present or late as one full class
                    {classLengthKnown ? "" : " (once the class length is set)"}. Quiz time is measured while you answer.
                  </p>
                </Card>
              </div>
            </div>
          );
        }}
      </QueryState>
    </>
  );
}
