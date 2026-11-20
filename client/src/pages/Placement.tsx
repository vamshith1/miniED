import { useState } from "react";
import { useSearchParams } from "react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Download, Target } from "lucide-react";
import { api, downloadFile } from "../lib/api";
import { fmtPct } from "../lib/format";
import type { BatchPlacement, PlacementOverview } from "../lib/types";
import { Badge, Button, Card, EmptyState, ErrorBox, PageHeader, QueryState, Stat, Table, Td, Th, cx } from "../components/ui";
import { BandBadge, ReadinessMeter, weightsText } from "../components/Readiness";

/**
 * Placement readiness across batches: who is ready for interviews, who needs help,
 * and which skills the batch most needs to work on. Downloadable as CSV per batch.
 */
export function PlacementPage() {
  const [params, setParams] = useSearchParams();
  const overview = useQuery({ queryKey: ["placement", "overview"], queryFn: () => api.get<PlacementOverview>("/placement/batches") });
  // Start on the first batch that has students (an upcoming batch is usually still empty).
  const selected = params.get("batch") ?? (overview.data?.items.find((b) => b.students > 0) ?? overview.data?.items[0])?.id ?? null;

  return (
    <>
      <PageHeader title="Placement readiness" subtitle="Which students are ready for interviews, who needs help, and what each batch should work on next." />
      <QueryState query={overview}>
        {({ items }) =>
          items.length === 0 ? (
            <Card>
              <EmptyState title="No batches yet" />
            </Card>
          ) : (
            <>
              <ul className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((b) => (
                  <li key={b.id}>
                    <button
                      type="button"
                      onClick={() => setParams({ batch: b.id }, { replace: true })}
                      aria-pressed={b.id === selected}
                      className={cx(
                        "h-full w-full rounded-lg border bg-surface p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:shadow-brand/10",
                        b.id === selected ? "border-brand ring-2 ring-brand/30" : "border-line hover:border-brand/40",
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-semibold">{b.name}</p>
                          <p className="truncate text-xs text-muted">
                            {b.course} · {b.students} student{b.students === 1 ? "" : "s"}
                          </p>
                        </div>
                        <span className="text-lg font-semibold tabular-nums">{fmtPct(b.averageReadiness)}</span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
                        <Badge tone="good">{b.ready} ready</Badge>
                        <Badge tone="warn">{b.almost} almost</Badge>
                        <Badge tone="bad">{b.needsWork} need work</Badge>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
              {selected && <BatchReport key={selected} batchId={selected} />}
            </>
          )
        }
      </QueryState>
    </>
  );
}

function BatchReport({ batchId }: { batchId: string }) {
  const report = useQuery({ queryKey: ["placement", batchId], queryFn: () => api.get<BatchPlacement>(`/placement/batches/${batchId}`) });
  const [filter, setFilter] = useState<"ALL" | "READY" | "ALMOST" | "NEEDS_WORK">("ALL");
  const csv = useMutation({ mutationFn: (name: string) => downloadFile(`/placement/batches/${batchId}/report.csv`, `placement-${name}.csv`) });

  return (
    <QueryState query={report}>
      {(r) => {
        const rows = filter === "ALL" ? r.items : r.items.filter((x) => x.band === filter);
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Average readiness" value={fmtPct(r.summary.averageReadiness)} hint={`${r.summary.scored} of ${r.summary.students} with data`} icon={<Target className="size-4" />} />
              <Stat label="Ready" value={r.summary.ready} tone="good" hint="75% and above" />
              <Stat label="Almost ready" value={r.summary.almost} hint="50–75%" />
              <Stat label="Need work" value={r.summary.needsWork} tone={r.summary.needsWork ? "bad" : undefined} hint="Under 50%" />
            </div>

            {/* minmax(0, 1fr): the wide table scrolls inside its card instead of pushing the page sideways */}
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
              <Card
                title={`${r.batch.name}: students`}
                padded={false}
                actions={
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={filter}
                      onChange={(e) => setFilter(e.target.value as typeof filter)}
                      className="h-8 rounded-md border border-line bg-surface px-2 text-sm"
                      aria-label="Show"
                    >
                      <option value="ALL">Everyone</option>
                      <option value="READY">Ready</option>
                      <option value="ALMOST">Almost ready</option>
                      <option value="NEEDS_WORK">Needs work</option>
                    </select>
                    <Button size="sm" variant="secondary" loading={csv.isPending} onClick={() => csv.mutate(r.batch.name)}>
                      <Download className="size-4" /> CSV
                    </Button>
                  </div>
                }
              >
                <ErrorBox error={csv.error} />
                {rows.length === 0 ? (
                  <EmptyState title={r.items.length ? "No one in this group" : "No students in this batch"} />
                ) : (
                  <Table>
                    <thead>
                      <tr>
                        <Th>Student</Th>
                        <Th>Readiness</Th>
                        <Th className="text-right">Quizzes</Th>
                        <Th className="text-right">Attendance</Th>
                        <Th className="text-right">Tasks</Th>
                        <Th>Skill gaps</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((x) => (
                        <tr key={x.student.id}>
                          <Td>
                            <div className="font-medium">
                              {x.student.name} {!x.student.isActive && <Badge tone="bad">Deactivated</Badge>}
                            </div>
                            <div className="text-xs text-muted">{x.student.email}</div>
                          </Td>
                          <Td>
                            <div className="flex items-center gap-2">
                              <ReadinessMeter value={x.readiness} band={x.band} />
                              <BandBadge band={x.band} />
                            </div>
                          </Td>
                          <Td className="text-right tabular-nums">
                            {fmtPct(x.quizAverage)}
                            <div className="text-xs text-faint">{x.quizzesTaken} taken</div>
                          </Td>
                          <Td className={cx("text-right tabular-nums", x.attendance != null && x.attendance < 75 && "text-bad")}>{fmtPct(x.attendance)}</Td>
                          <Td className="text-right tabular-nums">{x.tasksDue ? `${x.tasksAccepted}/${x.tasksDue}` : "—"}</Td>
                          <Td>
                            {x.gaps.length ? (
                              <span className="flex flex-wrap gap-1">
                                {x.gaps.slice(0, 3).map((g) => (
                                  <Badge key={g} tone="bad">
                                    {g}
                                  </Badge>
                                ))}
                                {x.gaps.length > 3 && <span className="text-xs text-muted">+{x.gaps.length - 3}</span>}
                              </span>
                            ) : (
                              <span className="text-faint">—</span>
                            )}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                )}
              </Card>

              <div className="space-y-4">
                <Card title="What to teach next">
                  {r.summary.topGaps.length === 0 ? (
                    <p className="text-sm text-muted">No common skill gaps. Tag quiz questions with a skill to see them here.</p>
                  ) : (
                    <ul className="space-y-2">
                      {r.summary.topGaps.map((g) => (
                        <li key={g.skill} className="flex items-center justify-between gap-2 text-sm">
                          <span className="font-medium">{g.skill}</span>
                          <span className="text-xs text-muted">
                            {g.students} student{g.students === 1 ? "" : "s"} struggling
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
                <p className="text-xs text-muted">{weightsText(r.weights)}</p>
              </div>
            </div>
          </div>
        );
      }}
    </QueryState>
  );
}
