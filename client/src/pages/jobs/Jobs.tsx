import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { api } from "../../lib/api";
import { useUser } from "../../lib/auth";
import { fmtDate } from "../../lib/format";
import type { ManagedJob } from "../../lib/types";
import { Badge, Button, Card, EmptyState, PageHeader, QueryState, Table, Td, Th } from "../../components/ui";
import { JobFacts, JobFormModal } from "../../components/Jobs";

/** Recruiters: their jobs. Admins: every job and campus drive. */
export function JobsPage() {
  const user = useUser();
  const [creating, setCreating] = useState(false);
  const jobs = useQuery({ queryKey: ["jobs"], queryFn: () => api.get<{ items: ManagedJob[] }>("/jobs").then((r) => r.items) });

  return (
    <>
      <PageHeader
        title={user.role === "ADMIN" ? "Jobs & campus drives" : "Your jobs"}
        subtitle={user.role === "ADMIN" ? "Every job recruiters have posted, and drives the institute runs." : `Post jobs for ${user.company ?? "your company"}, run hiring tests and interviews, and track every applicant.`}
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" /> Post a job
          </Button>
        }
      />
      <Card padded={false}>
        <QueryState query={jobs}>
          {(items) =>
            items.length === 0 ? (
              <EmptyState title="No jobs yet">Post one: students see it on their Careers page and apply.</EmptyState>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Job</Th>
                    <Th>Status</Th>
                    <Th className="text-right">Applicants</Th>
                    <Th className="text-right">Shortlisted</Th>
                    <Th className="text-right">Interviews</Th>
                    <Th className="text-right">Offers / hired</Th>
                    <Th>Posted</Th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((j) => (
                    <tr key={j.id}>
                      <Td>
                        <Link to={`/jobs/${j.id}`} className="font-medium text-brand-strong hover:underline">
                          {j.title}
                        </Link>
                        <JobFacts job={j} className="mt-0.5" />
                      </Td>
                      <Td>
                        <span className="flex flex-wrap gap-1">
                          <Badge tone={j.status === "OPEN" ? "good" : "neutral"}>{j.status === "OPEN" ? "Open" : "Closed"}</Badge>
                          {j.isCampusDrive && <Badge tone="brand">Campus drive</Badge>}
                        </span>
                      </Td>
                      <Td className="text-right tabular-nums">{j.applicants ?? 0}</Td>
                      <Td className="text-right tabular-nums">{j.byStatus?.SHORTLISTED ?? 0}</Td>
                      <Td className="text-right tabular-nums">{j.byStatus?.INTERVIEW ?? 0}</Td>
                      <Td className="text-right tabular-nums">
                        {(j.byStatus?.OFFERED ?? 0)} / {(j.byStatus?.HIRED ?? 0)}
                      </Td>
                      <Td className="whitespace-nowrap text-muted">
                        {fmtDate(j.createdAt)}
                        {user.role === "ADMIN" && <div className="text-xs">by {j.postedBy.name}</div>}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )
          }
        </QueryState>
      </Card>
      {creating && <JobFormModal open onClose={() => setCreating(false)} />}
    </>
  );
}
