import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Download, Search } from "lucide-react";
import { api, downloadFile, qs } from "../../lib/api";
import { fmtPct } from "../../lib/format";
import type { TalentRow } from "../../lib/types";
import { Badge, Card, EmptyState, ErrorBox, Input, PageHeader, QueryState, Select, Table, Td, Th } from "../../components/ui";
import { BandBadge, ReadinessMeter } from "../../components/Readiness";

/** Students who chose to be visible to recruiters, best prepared first. */
export function TalentPage() {
  const [q, setQ] = useState("");
  const [skill, setSkill] = useState("");
  const [min, setMin] = useState("");
  const [batchId, setBatchId] = useState("");
  const batches = useQuery({ queryKey: ["jobs", "batch-options"], queryFn: () => api.get<{ items: { id: string; name: string }[] }>("/jobs/batch-options").then((r) => r.items) });
  const pool = useQuery({
    queryKey: ["talent", q, skill, min, batchId],
    queryFn: () => api.get<{ items: TalentRow[] }>(`/jobs/talent${qs({ q, skill, minReadiness: min, batchId })}`).then((r) => r.items),
    placeholderData: (prev) => prev,
  });
  const resume = useMutation({ mutationFn: (r: { id: string; originalName: string }) => downloadFile(`/documents/${r.id}/download`, r.originalName) });

  return (
    <>
      <PageHeader title="Talent pool" subtitle="Students who chose to share their profile with recruiters, ranked by placement readiness." />
      <Card className="mb-4">
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_140px_180px]">
          <label className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-faint" />
            <Input className="pl-8" placeholder="Name or email" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search by name or email" />
          </label>
          <Input placeholder="Strong in skill, e.g. React" value={skill} onChange={(e) => setSkill(e.target.value)} aria-label="Skill" />
          <Select value={min} onChange={(e) => setMin(e.target.value)} aria-label="Minimum readiness">
            <option value="">Any readiness</option>
            <option value="50">50%+</option>
            <option value="75">75%+ (ready)</option>
            <option value="90">90%+</option>
          </Select>
          <Select value={batchId} onChange={(e) => setBatchId(e.target.value)} aria-label="Batch">
            <option value="">All batches</option>
            {batches.data?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </div>
      </Card>
      <ErrorBox error={resume.error} />
      <Card padded={false}>
        <QueryState query={pool}>
          {(items) =>
            items.length === 0 ? (
              <EmptyState title="No students match">Students appear here once they turn on profile sharing on their Careers page.</EmptyState>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Student</Th>
                    <Th>Readiness</Th>
                    <Th className="text-right">Quizzes</Th>
                    <Th className="text-right">Attendance</Th>
                    <Th>Strengths</Th>
                    <Th>Resume</Th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((x) => (
                    <tr key={x.student.id}>
                      <Td>
                        <div className="font-medium">{x.student.name}</div>
                        <div className="text-xs text-muted">{x.student.email}</div>
                        {x.student.batch && <div className="text-xs text-faint">{x.student.batch.course} · {x.student.batch.name}</div>}
                      </Td>
                      <Td>
                        <div className="flex items-center gap-2">
                          <ReadinessMeter value={x.readiness} band={x.band} />
                          <BandBadge band={x.band} />
                        </div>
                      </Td>
                      <Td className="text-right tabular-nums">{fmtPct(x.quizAverage)}</Td>
                      <Td className="text-right tabular-nums">{fmtPct(x.attendance)}</Td>
                      <Td>
                        {x.strengths.length ? (
                          <span className="flex max-w-xs flex-wrap gap-1">
                            {x.strengths.slice(0, 4).map((s) => (
                              <Badge key={s} tone="good">
                                {s}
                              </Badge>
                            ))}
                          </span>
                        ) : (
                          <span className="text-faint">—</span>
                        )}
                      </Td>
                      <Td>
                        {x.resume ? (
                          <button type="button" onClick={() => resume.mutate(x.resume!)} className="inline-flex items-center gap-1 text-sm font-medium text-brand-strong hover:underline">
                            <Download className="size-4" /> Download
                          </button>
                        ) : (
                          <span className="text-xs text-faint">None</span>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )
          }
        </QueryState>
      </Card>
    </>
  );
}
