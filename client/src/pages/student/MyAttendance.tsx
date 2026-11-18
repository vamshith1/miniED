import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarCheck, CalendarX, ChevronLeft, ChevronRight, Clock, Flame, Percent } from "lucide-react";
import { api } from "../../lib/api";
import { fmtDay, todayYmd } from "../../lib/format";
import type { AttendanceHistory, AttendanceMark } from "../../lib/types";
import { AnimatedNumber, Badge, Button, Card, EmptyState, PageHeader, QueryState, Stat, cx } from "../../components/ui";

const pctFmt = (n: number) => `${Math.round(n * 10) / 10}%`;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const monthFmt = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
const weekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: "short" });

const markStyle: Record<AttendanceMark, string> = {
  PRESENT: "bg-good-soft text-good border-good/40",
  LATE: "bg-warn-soft text-warn border-warn/40",
  ABSENT: "bg-bad-soft text-bad border-bad/40",
};
const markLabel: Record<AttendanceMark, string> = { PRESENT: "Present", LATE: "Late", ABSENT: "Absent" };
const markTone = (s: AttendanceMark) => (s === "PRESENT" ? "good" : s === "LATE" ? "warn" : "bad");

const ym = (ymd: string) => ymd.slice(0, 7); // "2026-11"
const fromYm = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1);
};
const addMonths = (key: string, n: number) => {
  const d = fromYm(key);
  d.setMonth(d.getMonth() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

/** One month as a calendar: each day coloured by its mark; unmarked days stay plain. */
function MonthCalendar({ month, marks, batchStart }: { month: string; marks: Map<string, AttendanceMark>; batchStart?: string }) {
  const first = fromYm(month);
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7; // Monday-first grid
  const today = todayYmd();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`)];

  return (
    <div>
      <div className="mb-1 grid grid-cols-7 gap-1 text-center text-xs font-medium text-faint">
        {WEEKDAYS.map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, i) => {
          if (!day) return <div key={`blank-${i}`} />;
          const mark = marks.get(day);
          const beforeBatch = batchStart && day < batchStart;
          return (
            <div
              key={day}
              title={mark ? `${fmtDay(day)}: ${markLabel[mark]}` : fmtDay(day)}
              className={cx(
                "flex aspect-square flex-col items-center justify-center rounded-md border text-sm tabular-nums transition-transform duration-150",
                mark ? cx(markStyle[mark], "font-semibold hover:scale-105") : "border-transparent text-muted",
                beforeBatch && "opacity-40",
                day === today && "ring-2 ring-brand/60",
              )}
            >
              {Number(day.slice(8))}
              {mark && <span className="hidden text-[10px] font-medium leading-none sm:block">{markLabel[mark]}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function MyAttendancePage() {
  const history = useQuery({ queryKey: ["progress", "attendance"], queryFn: () => api.get<AttendanceHistory>("/progress/attendance") });
  const [month, setMonth] = useState<string | null>(null);

  const marks = useMemo(() => new Map((history.data?.records ?? []).map((r) => [r.date, r.status])), [history.data]);

  return (
    <>
      <PageHeader title="My attendance" subtitle="Every day your mentor marked, month by month. Late counts as attended." />
      <QueryState query={history}>
        {({ summary, records, batch }) => {
          if (records.length === 0) {
            return (
              <Card>
                <EmptyState title="No attendance marked yet">Once your mentor marks a class, each day shows up here.</EmptyState>
              </Card>
            );
          }
          // Months from the first marked day to this month.
          const firstMonth = ym(records[0].date);
          const lastMonth = ym(todayYmd()) > ym(records.at(-1)!.date) ? ym(todayYmd()) : ym(records.at(-1)!.date);
          const shown = month ?? lastMonth;
          const inMonth = records.filter((r) => ym(r.date) === shown);
          const monthAttended = inMonth.filter((r) => r.status !== "ABSENT").length;

          return (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <div className="animate-fade-up">
                  <Stat
                    label="Attendance"
                    icon={<Percent className="size-4" />}
                    tone={summary.percentage !== null && summary.percentage < 75 ? "bad" : "good"}
                    value={<AnimatedNumber value={summary.percentage} format={pctFmt} />}
                    hint={`${summary.present + summary.late} of ${summary.marked} days${summary.percentage !== null && summary.percentage < 75 ? " · below the 75% target" : ""}`}
                  />
                </div>
                <div className="animate-fade-up" style={{ animationDelay: "50ms" }}>
                  <Stat label="Present" icon={<CalendarCheck className="size-4" />} tone="good" value={<AnimatedNumber value={summary.present} />} hint={`${summary.late} late`} />
                </div>
                <div className="animate-fade-up" style={{ animationDelay: "100ms" }}>
                  <Stat label="Absent" icon={<CalendarX className="size-4" />} tone={summary.absent ? "bad" : undefined} value={<AnimatedNumber value={summary.absent} />} hint={summary.absent ? "Days missed" : "Not a single day missed"} />
                </div>
                <div className="animate-fade-up" style={{ animationDelay: "150ms" }}>
                  <Stat
                    label="Current streak"
                    icon={<Flame className="size-4" />}
                    value={`${summary.currentStreak} day${summary.currentStreak === 1 ? "" : "s"}`}
                    hint={`Longest: ${summary.longestStreak} day${summary.longestStreak === 1 ? "" : "s"} in a row`}
                  />
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
                <div className="animate-fade-up" style={{ animationDelay: "200ms" }}>
                  <Card
                    title={
                      <span>
                        {monthFmt.format(fromYm(shown))}
                        <span className="ml-2 font-normal text-muted">
                          {inMonth.length ? `${monthAttended} of ${inMonth.length} attended` : "no classes marked"}
                        </span>
                      </span>
                    }
                    actions={
                      <>
                        <Button size="sm" variant="ghost" disabled={shown <= firstMonth} onClick={() => setMonth(addMonths(shown, -1))} aria-label="Previous month">
                          <ChevronLeft className="size-4" />
                        </Button>
                        <Button size="sm" variant="ghost" disabled={shown >= lastMonth} onClick={() => setMonth(addMonths(shown, 1))} aria-label="Next month">
                          <ChevronRight className="size-4" />
                        </Button>
                      </>
                    }
                  >
                    <MonthCalendar month={shown} marks={marks} batchStart={batch?.startDate} />
                    <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted">
                      {(["PRESENT", "LATE", "ABSENT"] as AttendanceMark[]).map((s) => (
                        <span key={s} className="flex items-center gap-1.5">
                          <span className={cx("size-3 rounded border", markStyle[s])} /> {markLabel[s]}
                        </span>
                      ))}
                      <span className="flex items-center gap-1.5">
                        <span className="size-3 rounded ring-2 ring-brand/60" /> Today
                      </span>
                    </div>
                  </Card>
                </div>

                <div className="animate-fade-up" style={{ animationDelay: "250ms" }}>
                  <Card title="Every day" padded={false}>
                    <ul className="max-h-[420px] divide-y divide-line overflow-y-auto">
                      {[...records].reverse().map((r) => (
                        <li key={r.date} className="flex items-center justify-between gap-2 px-4 py-2 text-sm transition-colors hover:bg-brand-soft/30">
                          <span>
                            <span className="font-medium">{fmtDay(r.date)}</span>{" "}
                            <span className="text-xs text-muted">{weekdayFmt.format(new Date(`${r.date}T00:00:00`))}</span>
                          </span>
                          <Badge tone={markTone(r.status)}>
                            {r.status === "LATE" && <Clock className="mr-1 size-3" />}
                            {markLabel[r.status]}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  </Card>
                </div>
              </div>
            </div>
          );
        }}
      </QueryState>
    </>
  );
}
