import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, LabelList, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { api } from "../../lib/api";
import { fmtDay, fmtPct, relative, titleCase } from "../../lib/format";
import { STAGES, type DashboardStats } from "../../lib/types";
import { Button, Card, PageHeader, QueryState, Stat, cx } from "../../components/ui";

// Chart colours (validated: lightness, chroma, colour-blind separation, contrast).
// Slot 1 = new leads / single-series bars, slot 2 = conversions.
const SERIES_1 = "#2a78d6";
const SERIES_2 = "#eb6834";
const GRID = "#e8eaed";
const AXIS_TEXT = "#5f6b78";
const TICK = { fill: AXIS_TEXT, fontSize: 12 };

// One tooltip style for every chart: text in ink colours, a swatch carries the series identity.
function ChartTooltip({ active, payload, label, format }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string; format?: (v: number) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium text-ink">{label}</p>
      {payload.map((p) => (
        <p key={p.name} className="flex items-center gap-2 text-muted">
          <span className="size-2.5 rounded-sm" style={{ background: p.color }} />
          {p.name}: <span className="font-medium tabular-nums text-ink">{format ? format(p.value) : p.value}</span>
        </p>
      ))}
    </div>
  );
}

// Legend in the same order as the bars (Recharts would sort it alphabetically).
function SeriesLegend({ items }: { items: { name: string; color: string }[] }) {
  return (
    <ul className="flex justify-center gap-4 pt-1 text-xs text-muted">
      {items.map((i) => (
        <li key={i.name} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: i.color }} /> {i.name}
        </li>
      ))}
    </ul>
  );
}

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
        <button onClick={() => setAsTable(!asTable)} className="text-xs font-medium text-brand hover:underline" aria-pressed={asTable}>
          {asTable ? "Chart" : "Table"}
        </button>
      }
    >
      {asTable ? <div className="max-h-[260px] overflow-y-auto">{table}</div> : <div style={{ height }}>{children}</div>}
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

export function DashboardPage() {
  const stats = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api.get<DashboardStats>("/dashboard/stats"),
    refetchInterval: 60_000,
  });
  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={stats.data ? `Updated ${relative(stats.data.generatedAt)} · refreshes every minute` : undefined}
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

function DashboardBody({ s }: { s: DashboardStats }) {
  const weeks = s.leads.perWeek.map((w) => ({ ...w, label: fmtDay(w.weekStart).replace(/,? \d{4}$/, "") }));
  const stages = STAGES.map((st) => ({ stage: titleCase(st), count: s.leads.byStage[st] }));
  const atRisk = s.attendance.byBatch.filter((b) => b.percentage !== null && b.percentage < 75);
  const failed = s.emails.last7Days.failed;

  return (
    <div className="space-y-4">
      {/* Headline numbers */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Leads" value={s.leads.total} hint={`${s.leads.byStage.NEW + s.leads.byStage.CONTACTED + s.leads.byStage.INTERESTED} still open`} />
        <Link to="/leads?followUpDue=true" className="block rounded-lg transition-shadow hover:shadow-sm">
          <Stat label="Follow-ups due" value={s.leads.followUpsDue} hint="Today or overdue · open list →" tone={s.leads.followUpsDue > 0 ? "bad" : undefined} />
        </Link>
        <Stat label="Conversion rate" value={fmtPct(s.leads.conversionRate)} hint="Enrolled ÷ (enrolled + lost)" />
        <Stat label="Students" value={s.students} hint={`${s.batches.active} running batches · ${s.mentors} mentors`} />
        <Stat label="Attendance" value={fmtPct(s.attendance.last30Days.percentage)} hint={`Last 30 days · ${s.attendance.last30Days.recordsMarked} marks`} />
        <Stat label="Quiz average" value={fmtPct(s.quizzes.averageScoreLast30Days)} hint={`${s.quizzes.attemptsLast30Days} submissions in 30 days`} />
        <Stat label="Published quizzes" value={s.quizzes.published} />
        <Link to={failed ? "/emails?status=FAILED" : "/emails"} className="block rounded-lg transition-shadow hover:shadow-sm">
          <Stat
            label="Emails sent (7 days)"
            value={s.emails.last7Days.sent}
            hint={
              failed ? (
                <span className="font-medium text-bad">⚠ {failed} failed · review →</span>
              ) : (
                `${s.emails.last7Days.queued} queued · none failed`
              )
            }
          />
        </Link>
      </div>

      {atRisk.length > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-bad/30 bg-bad-soft px-3 py-2 text-sm text-bad" role="status">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            Attendance below 75% in the last 30 days: {atRisk.map((b, i) => (
              <span key={b.batchId}>
                {i > 0 && ", "}
                <Link to={`/batches/${b.batchId}?tab=attendance`} className="font-medium underline">
                  {b.name}
                </Link>{" "}
                ({fmtPct(b.percentage)})
              </span>
            ))}
          </span>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
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
              <Tooltip content={<ChartTooltip />} cursor={{ fill: "#f1f3f5" }} />
              <Legend content={<SeriesLegend items={[{ name: "New leads", color: SERIES_1 }, { name: "Converted", color: SERIES_2 }]} />} />
              <Bar dataKey="created" name="New leads" fill={SERIES_1} radius={[4, 4, 0, 0]} maxBarSize={20} />
              <Bar dataKey="converted" name="Converted" fill={SERIES_2} radius={[4, 4, 0, 0]} maxBarSize={20} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Pipeline by stage" subtitle={`${s.leads.total} leads`} table={<MiniTable head={["Stage", "Leads"]} rows={stages.map((x) => [x.stage, x.count])} />}>
          <ResponsiveContainer>
            <BarChart data={stages} layout="vertical" margin={{ top: 4, right: 36, left: 8, bottom: 0 }}>
              <CartesianGrid horizontal={false} stroke={GRID} />
              <XAxis type="number" allowDecimals={false} tick={TICK} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="stage" tick={TICK} tickLine={false} axisLine={false} width={80} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: "#f1f3f5" }} />
              <Bar dataKey="count" name="Leads" fill={SERIES_1} radius={[0, 4, 4, 0]} maxBarSize={22}>
                <LabelList dataKey="count" position="right" style={{ fill: "#1d2630", fontSize: 12 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Where leads come from" subtitle="top sources" table={<MiniTable head={["Source", "Leads"]} rows={s.leads.bySource.map((x) => [x.source, x.count])} />}>
          {s.leads.bySource.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted">No leads yet.</p>
          ) : (
            <ResponsiveContainer>
              <BarChart data={s.leads.bySource} layout="vertical" margin={{ top: 4, right: 36, left: 8, bottom: 0 }}>
                <CartesianGrid horizontal={false} stroke={GRID} />
                <XAxis type="number" allowDecimals={false} tick={TICK} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="source" tick={TICK} tickLine={false} axisLine={false} width={104} tickFormatter={(v: string) => shorten(v, 14)} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: "#f1f3f5" }} />
                <Bar dataKey="count" name="Leads" fill={SERIES_1} radius={[0, 4, 4, 0]} maxBarSize={22}>
                  <LabelList dataKey="count" position="right" style={{ fill: "#1d2630", fontSize: 12 }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

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
                <Tooltip content={<ChartTooltip format={(v) => fmtPct(v)} />} cursor={{ fill: "#f1f3f5" }} />
                <Bar dataKey="percentage" name="Attendance" fill={SERIES_1} radius={[0, 4, 4, 0]} maxBarSize={22}>
                  <LabelList dataKey="percentage" position="right" formatter={(v) => fmtPct(Number(v))} style={{ fill: "#1d2630", fontSize: 12 }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>
    </div>
  );
}
