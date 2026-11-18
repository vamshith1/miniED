import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, LabelList, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, BookCheck, CalendarCheck, GraduationCap, IndianRupee, Mail, Percent, PhoneCall, RefreshCw, Trophy, UserRoundSearch } from "lucide-react";
import { usePaymentConfig } from "../../components/Payments";
import { AXIS_TEXT, CURSOR, ChartTooltip, GRID, HOVER_BAR, SERIES_1, SERIES_2, SeriesLegend, TICK } from "../../components/charts";
import { api } from "../../lib/api";
import { fmtDay, fmtMoney, fmtPct, relative, titleCase } from "../../lib/format";
import { STAGES, type DashboardStats } from "../../lib/types";
import { AnimatedNumber, Button, Card, PageHeader, QueryState, Stat, cx } from "../../components/ui";

const REFRESH_MS = 30_000;

// Cards slide in one after another on first load.
const stagger = (i: number): CSSProperties => ({ animationDelay: `${i * 50}ms` });
const pctFmt = (n: number) => `${Math.round(n * 10) / 10}%`;

const shorten = (v: string, n = 16) => (v.length > n ? `${v.slice(0, n - 1)}…` : v);

// A chart card with a "Table" toggle, so every number is readable without the chart.
function ChartCard({ title, subtitle, table, children, height = 260 }: { title: string; subtitle?: string; table: ReactNode; children: ReactNode; height?: number }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <Card
      title={
        <span>
          {title}
          {subtitle && <span className="ml-2 font-normal text-muted">{subtitle}</span>}
        </span>
      }
      actions={
        <button
          onClick={() => setAsTable(!asTable)}
          className="rounded-md px-2 py-1 text-xs font-medium text-brand-strong transition-colors hover:bg-brand-soft"
          aria-pressed={asTable}
        >
          {asTable ? "Show chart" : "Show table"}
        </button>
      }
      className="h-full transition-shadow duration-200 hover:shadow-md hover:shadow-brand/5"
    >
      {asTable ? (
        <div className="animate-fade-in max-h-[260px] overflow-y-auto">{table}</div>
      ) : (
        <div className="animate-fade-in" style={{ height }}>
          {children}
        </div>
      )}
    </Card>
  );
}

function MiniTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr>
          {head.map((h, i) => (
            <th key={h} className={cx("border-b border-line pb-1.5 text-xs font-medium text-muted", i > 0 && "text-right")}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, ri) => (
          <tr key={ri}>
            {r.map((c, i) => (
              <td key={i} className={cx("border-b border-line py-1.5", i > 0 && "text-right tabular-nums")}>
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Re-renders every few seconds so "updated 20 seconds ago" keeps counting.
function useNow(everyMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

function secondsAgo(iso: string, now: number) {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  return s < 5 ? "just now" : s < 60 ? `${s}s ago` : relative(iso);
}

function LiveBadge({ updatedAt, fetching }: { updatedAt?: string; fetching: boolean }) {
  const now = useNow(5_000);
  return (
    <span className="inline-flex items-center gap-2" aria-live="polite">
      <span className="relative flex size-2.5">
        <span className={cx("absolute inline-flex size-full rounded-full bg-good/60", !fetching && "animate-ping")} />
        <span className="relative inline-flex size-2.5 rounded-full bg-good" />
      </span>
      <span>
        Live · {fetching ? "updating…" : updatedAt ? `updated ${secondsAgo(updatedAt, now)}` : "loading…"} · refreshes every {REFRESH_MS / 1000}s
      </span>
    </span>
  );
}

export function DashboardPage() {
  const stats = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api.get<DashboardStats>("/dashboard/stats"),
    refetchInterval: REFRESH_MS,
    refetchOnWindowFocus: true, // coming back to the tab shows fresh numbers
  });
  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={<LiveBadge updatedAt={stats.data?.generatedAt} fetching={stats.isFetching} />}
        actions={
          <Button variant="secondary" size="sm" loading={stats.isFetching} onClick={() => stats.refetch()}>
            <RefreshCw className="size-4" /> Refresh
          </Button>
        }
      />
      <QueryState query={stats}>{(s) => <DashboardBody s={s} />}</QueryState>
    </>
  );
}

// A headline number that opens the matching page.
function StatLink({ to, index, ...stat }: Parameters<typeof Stat>[0] & { to: string; index: number }) {
  return (
    <Link to={to} className="animate-fade-up block rounded-lg focus-visible:outline-offset-4" style={stagger(index)}>
      <Stat {...stat} interactive />
    </Link>
  );
}

function DashboardBody({ s }: { s: DashboardStats }) {
  const weeks = s.leads.perWeek.map((w) => ({ ...w, label: fmtDay(w.weekStart).replace(/,? \d{4}$/, "") }));
  const navigate = useNavigate();
  const paymentsOn = !!usePaymentConfig().data?.enabled;
  const stages = STAGES.map((st) => ({ stage: titleCase(st), raw: st, count: s.leads.byStage[st] }));
  const atRisk = s.attendance.byBatch.filter((b) => b.percentage !== null && b.percentage < 75);
  // Stats cached by an older server version (up to 60 s after a deploy) may not have this yet.
  const quizByBatch = s.quizzes.byBatch ?? [];
  const failed = s.emails.last7Days.failed;

  return (
    <div className="space-y-4">
      {/* Headline numbers: each opens the page behind it, and counts up when it changes */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatLink
          index={0}
          to="/leads"
          icon={<UserRoundSearch className="size-4" />}
          label="Leads"
          value={<AnimatedNumber value={s.leads.total} />}
          hint={`${s.leads.byStage.NEW + s.leads.byStage.CONTACTED + s.leads.byStage.INTERESTED} still open`}
        />
        <StatLink
          index={1}
          to="/leads?followUpDue=true"
          icon={<PhoneCall className="size-4" />}
          label="Follow-ups due"
          value={<AnimatedNumber value={s.leads.followUpsDue} />}
          hint="Today or overdue · open list →"
          tone={s.leads.followUpsDue > 0 ? "bad" : undefined}
        />
        <StatLink
          index={2}
          to="/leads?stage=ENROLLED"
          icon={<Percent className="size-4" />}
          label="Conversion rate"
          value={<AnimatedNumber value={s.leads.conversionRate} format={pctFmt} />}
          hint="Enrolled ÷ (enrolled + lost)"
        />
        <StatLink
          index={3}
          to="/batches"
          icon={<GraduationCap className="size-4" />}
          label="Students"
          value={<AnimatedNumber value={s.students} />}
          hint={`${s.batches.active} running batches · ${s.mentors} mentors`}
        />
        <StatLink
          index={4}
          to="/batches"
          icon={<CalendarCheck className="size-4" />}
          label="Attendance"
          value={<AnimatedNumber value={s.attendance.last30Days.percentage} format={pctFmt} />}
          hint={`Last 30 days · ${s.attendance.last30Days.recordsMarked} marks`}
          tone={s.attendance.last30Days.percentage !== null && s.attendance.last30Days.percentage < 75 ? "bad" : undefined}
        />
        <StatLink
          index={5}
          to="/batches"
          icon={<Trophy className="size-4" />}
          label="Quiz average"
          value={<AnimatedNumber value={s.quizzes.averageScoreLast30Days} format={pctFmt} />}
          hint={`${s.quizzes.attemptsLast30Days} submissions in 30 days · ${s.quizzes.published} published`}
        />
        {s.payments && paymentsOn ? (
          <StatLink
            index={6}
            to="/payments"
            icon={<IndianRupee className="size-4" />}
            label="Fees collected (30 days)"
            value={<AnimatedNumber value={s.payments.last30Days.collectedPaise} format={(n) => fmtMoney(Math.round(n))} />}
            tone={s.payments.last30Days.failed ? undefined : "good"}
            hint={
              s.payments.last30Days.failed ? (
                <span className="font-medium text-bad">
                  {s.payments.last30Days.paid} paid · {s.payments.last30Days.failed} failed →
                </span>
              ) : (
                `${s.payments.last30Days.paid} paid · ${s.payments.last30Days.pending} not completed`
              )
            }
          />
        ) : (
          <StatLink index={6} to="/batches" icon={<BookCheck className="size-4" />} label="Published quizzes" value={<AnimatedNumber value={s.quizzes.published} />} hint="Across all batches" />
        )}
        <StatLink
          index={7}
          to={failed ? "/emails?status=FAILED" : "/emails"}
          icon={<Mail className="size-4" />}
          label="Emails sent (7 days)"
          value={<AnimatedNumber value={s.emails.last7Days.sent} />}
          tone={failed ? "bad" : undefined}
          hint={failed ? <span className="font-medium text-bad">⚠ {failed} failed · review →</span> : `${s.emails.last7Days.queued} queued · none failed`}
        />
      </div>

      {atRisk.length > 0 && (
        <div className="animate-fade-up flex items-start gap-2 rounded-md border border-bad/30 bg-bad-soft px-3 py-2 text-sm text-bad" role="status" style={stagger(8)}>
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            Attendance below 75% in the last 30 days: {atRisk.map((b, i) => (
              <span key={b.batchId}>
                {i > 0 && ", "}
                <Link to={`/batches/${b.batchId}?tab=attendance`} className="font-medium underline hover:no-underline">
                  {b.name}
                </Link>{" "}
                ({fmtPct(b.percentage)})
              </span>
            ))}
          </span>
        </div>
      )}

      <p className="text-xs text-faint">Tip: click a bar in the stage, attendance or quiz charts to open what's behind it.</p>

      <div className="grid gap-4 lg:grid-cols-2">
        <Reveal index={9}>
          <ChartCard
            title="Leads per week"
            subtitle="last 8 weeks"
            table={<MiniTable head={["Week of", "New leads", "Converted"]} rows={weeks.map((w) => [fmtDay(w.weekStart), w.created, w.converted])} />}
          >
            <ResponsiveContainer>
              <BarChart data={weeks} barGap={2} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={GRID} />
                <XAxis dataKey="label" tick={TICK} tickLine={false} axisLine={{ stroke: GRID }} />
                <YAxis allowDecimals={false} tick={TICK} tickLine={false} axisLine={false} />
                <Tooltip isAnimationActive={false} content={<ChartTooltip />} cursor={{ fill: CURSOR }} />
                <Legend content={<SeriesLegend items={[{ name: "New leads", color: SERIES_1 }, { name: "Converted", color: SERIES_2 }]} />} />
                <Bar dataKey="created" name="New leads" fill={SERIES_1} activeBar={{ fill: HOVER_BAR }} radius={[4, 4, 0, 0]} maxBarSize={20} animationDuration={700} />
                <Bar dataKey="converted" name="Converted" fill={SERIES_2} activeBar={{ fill: "var(--chart-2-hover)" }} radius={[4, 4, 0, 0]} maxBarSize={20} animationDuration={700} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </Reveal>

        <Reveal index={10}>
          <ChartCard title="Pipeline by stage" subtitle={`${s.leads.total} leads`} table={<MiniTable head={["Stage", "Leads"]} rows={stages.map((x) => [x.stage, x.count])} />}>
            <ResponsiveContainer>
              <BarChart data={stages} layout="vertical" margin={{ top: 4, right: 36, left: 8, bottom: 0 }}>
                <CartesianGrid horizontal={false} stroke={GRID} />
                <XAxis type="number" allowDecimals={false} tick={TICK} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="stage" tick={TICK} tickLine={false} axisLine={false} width={80} />
                <Tooltip isAnimationActive={false} content={<ChartTooltip />} cursor={{ fill: CURSOR }} />
                <Bar
                  dataKey="count"
                  name="Leads"
                  fill={SERIES_1}
                  activeBar={{ fill: HOVER_BAR }}
                  radius={[0, 4, 4, 0]}
                  maxBarSize={22}
                  animationDuration={700}
                  className="cursor-pointer"
                  onClick={(e) => openRow<{ raw: string }>(e, (r) => navigate(`/leads?stage=${r.raw}`))}
                >
                  <LabelList dataKey="count" position="right" style={{ fill: "var(--chart-label)", fontSize: 12 }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </Reveal>

        <Reveal index={11}>
          <ChartCard title="Where leads come from" subtitle="top sources" table={<MiniTable head={["Source", "Leads"]} rows={s.leads.bySource.map((x) => [x.source, x.count])} />}>
            {s.leads.bySource.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted">No leads yet.</p>
            ) : (
              <ResponsiveContainer>
                <BarChart data={s.leads.bySource} layout="vertical" margin={{ top: 4, right: 36, left: 8, bottom: 0 }}>
                  <CartesianGrid horizontal={false} stroke={GRID} />
                  <XAxis type="number" allowDecimals={false} tick={TICK} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="source" tick={TICK} tickLine={false} axisLine={false} width={104} tickFormatter={(v: string) => shorten(v, 14)} />
                  <Tooltip isAnimationActive={false} content={<ChartTooltip />} cursor={{ fill: CURSOR }} />
                  <Bar dataKey="count" name="Leads" fill={SERIES_1} activeBar={{ fill: HOVER_BAR }} radius={[0, 4, 4, 0]} maxBarSize={22} animationDuration={700}>
                    <LabelList dataKey="count" position="right" style={{ fill: "var(--chart-label)", fontSize: 12 }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
        </Reveal>

        <Reveal index={12}>
          <ChartCard
            title="Attendance by batch"
            subtitle="30 days, lowest first"
            table={<MiniTable head={["Batch", "Attendance"]} rows={s.attendance.byBatch.map((b) => [b.name, `${fmtPct(b.percentage)}${b.percentage !== null && b.percentage < 75 ? " (below 75%)" : ""}`])} />}
          >
            {s.attendance.byBatch.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted">No attendance marked in the last 30 days.</p>
            ) : (
              <ResponsiveContainer>
                <BarChart data={s.attendance.byBatch.slice(0, 8)} layout="vertical" margin={{ top: 20, right: 48, left: 8, bottom: 0 }}>
                  <CartesianGrid horizontal={false} stroke={GRID} />
                  <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={TICK} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="name" tick={TICK} tickLine={false} axisLine={false} width={124} tickFormatter={(v: string) => shorten(v)} />
                  <ReferenceLine x={75} stroke={AXIS_TEXT} strokeDasharray="0" label={{ value: "75% target", position: "top", fill: AXIS_TEXT, fontSize: 11 }} />
                  <Tooltip isAnimationActive={false} content={<ChartTooltip format={(v) => fmtPct(v)} />} cursor={{ fill: CURSOR }} />
                  <Bar
                    dataKey="percentage"
                    name="Attendance"
                    fill={SERIES_1}
                    activeBar={{ fill: HOVER_BAR }}
                    radius={[0, 4, 4, 0]}
                    maxBarSize={22}
                    animationDuration={700}
                    className="cursor-pointer"
                    onClick={(e) => openRow<{ batchId: string }>(e, (r) => navigate(`/batches/${r.batchId}?tab=attendance`))}
                  >
                    <LabelList dataKey="percentage" position="right" formatter={(v) => fmtPct(Number(v))} style={{ fill: "var(--chart-label)", fontSize: 12 }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
        </Reveal>

        <Reveal index={13}>
          <ChartCard
            title="Average quiz score by batch"
            subtitle="all quizzes, highest first"
            table={<MiniTable head={["Batch", "Average score", "Attempts"]} rows={quizByBatch.map((b) => [b.name, fmtPct(b.averageScore), b.attempts])} />}
          >
            {quizByBatch.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted">No quiz attempts yet.</p>
            ) : (
              <ResponsiveContainer>
                <BarChart data={quizByBatch.slice(0, 8)} layout="vertical" margin={{ top: 4, right: 48, left: 8, bottom: 0 }}>
                  <CartesianGrid horizontal={false} stroke={GRID} />
                  <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={TICK} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="name" tick={TICK} tickLine={false} axisLine={false} width={124} tickFormatter={(v: string) => shorten(v)} />
                  <Tooltip isAnimationActive={false} content={<ChartTooltip format={(v) => fmtPct(v)} />} cursor={{ fill: CURSOR }} />
                  <Bar
                    dataKey="averageScore"
                    name="Average score"
                    fill={SERIES_1}
                    activeBar={{ fill: HOVER_BAR }}
                    radius={[0, 4, 4, 0]}
                    maxBarSize={22}
                    animationDuration={700}
                    className="cursor-pointer"
                    onClick={(e) => openRow<{ batchId: string }>(e, (r) => navigate(`/batches/${r.batchId}?tab=leaderboard`))}
                  >
                    <LabelList dataKey="averageScore" position="right" formatter={(v) => fmtPct(Number(v))} style={{ fill: "var(--chart-label)", fontSize: 12 }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
        </Reveal>
      </div>
    </div>
  );
}

// Fades a block in, after the ones before it.
function Reveal({ index, children }: { index: number; children: ReactNode }) {
  return (
    <div className="animate-fade-up h-full" style={stagger(index)}>
      {children}
    </div>
  );
}

// Recharts passes the clicked bar with its data row under "payload".
function openRow<T>(entry: unknown, go: (row: T) => void) {
  const row = (entry as { payload?: T } | undefined)?.payload;
  if (row) go(row);
}
