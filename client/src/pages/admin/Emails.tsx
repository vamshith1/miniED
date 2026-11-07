import { useState } from "react";
import { useSearchParams } from "react-router";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing } from "lucide-react";
import { api, qs } from "../../lib/api";
import { fmtDateTime } from "../../lib/format";
import type { EmailLog, EmailStatus, Paginated } from "../../lib/types";
import { Badge, Button, Card, EmptyState, ErrorBox, PageHeader, Pagination, QueryState, Select, Table, Td, Th } from "../../components/ui";

const TEMPLATE_LABEL: Record<EmailLog["template"], string> = {
  welcome: "Welcome",
  "quiz-result": "Quiz result",
  "lead-follow-up": "Follow-up reminder",
};
const statusTone = (s: EmailStatus) => (s === "SENT" ? "good" : s === "FAILED" ? "bad" : "warn");

interface ScanResult {
  dueLeads: number;
  queued: number;
  skippedAlreadyReminded: number;
}

export function EmailsPage() {
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const [status, setStatus] = useState(params.get("status") ?? "");
  const [template, setTemplate] = useState("");
  const [page, setPage] = useState(1);
  const emails = useQuery({
    queryKey: ["emails", status, template, page],
    queryFn: () => api.get<Paginated<EmailLog>>(`/emails${qs({ status, template, page, limit: 25 })}`),
    placeholderData: keepPreviousData,
    // Keep the list live while anything is still sending.
    refetchInterval: (q) => (q.state.data?.items.some((e) => e.status === "QUEUED") ? 3000 : false),
  });
  const runFollowUps = useMutation({
    mutationFn: () => api.post<ScanResult>("/emails/follow-ups/run"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["emails"] }),
  });

  return (
    <>
      <PageHeader
        title="Emails"
        subtitle="Every email the system has queued, with its delivery status. Failed sends are retried 5 times before they're marked failed."
        actions={
          <Button variant="secondary" loading={runFollowUps.isPending} onClick={() => runFollowUps.mutate()}>
            <BellRing className="size-4" /> Send today's follow-up reminders
          </Button>
        }
      />
      {runFollowUps.data && (
        <div className="mb-4 rounded-md border border-brand/20 bg-brand-soft px-3 py-2 text-sm text-brand-strong" role="status">
          {runFollowUps.data.dueLeads} leads due. Queued {runFollowUps.data.queued} reminder email{runFollowUps.data.queued === 1 ? "" : "s"}
          {runFollowUps.data.skippedAlreadyReminded ? `; ${runFollowUps.data.skippedAlreadyReminded} people were already reminded today` : ""}.
        </div>
      )}
      <ErrorBox error={runFollowUps.error} />

      <Card padded={false}>
        <div className="flex flex-wrap gap-2 border-b border-line p-3">
          <Select className="w-auto" value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))} aria-label="Status">
            <option value="">Any status</option>
            <option value="QUEUED">Queued / retrying</option>
            <option value="SENT">Sent</option>
            <option value="FAILED">Failed</option>
          </Select>
          <Select className="w-auto" value={template} onChange={(e) => (setTemplate(e.target.value), setPage(1))} aria-label="Type">
            <option value="">Any type</option>
            {Object.entries(TEMPLATE_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </div>
        <QueryState query={emails}>
          {(data) =>
            data.items.length === 0 ? (
              <EmptyState title="No emails" />
            ) : (
              <>
                <Table>
                  <thead>
                    <tr>
                      <Th>To</Th>
                      <Th>Type</Th>
                      <Th>Status</Th>
                      <Th>Attempts</Th>
                      <Th>Queued</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((e) => (
                      <tr key={e.id}>
                        <Td className="font-medium">{e.to}</Td>
                        <Td>{TEMPLATE_LABEL[e.template]}</Td>
                        <Td>
                          <Badge tone={statusTone(e.status)}>{e.status === "QUEUED" && e.attempts > 0 ? "Retrying" : e.status.toLowerCase()}</Badge>
                          {e.lastError && e.status !== "SENT" && <p className="mt-1 max-w-xs text-xs text-bad">{e.lastError}</p>}
                        </Td>
                        <Td className="tabular-nums">{e.attempts}</Td>
                        <Td className="text-muted">
                          {fmtDateTime(e.createdAt)}
                          {e.sentAt && <div className="text-xs">sent {fmtDateTime(e.sentAt)}</div>}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
                <Pagination page={data.page} totalPages={data.totalPages} onPage={setPage} />
              </>
            )
          }
        </QueryState>
      </Card>
    </>
  );
}
