import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Upload } from "lucide-react";
import { api, qs } from "../../lib/api";
import { fmtDay, titleCase, todayYmd } from "../../lib/format";
import { STAGES, type Lead, type Paginated, type User } from "../../lib/types";
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, Pagination, QueryState, Select, Table, Td, TextField, Th, fieldErrorsOf, stageTone } from "../../components/ui";

// Admins and mentors a lead can be assigned to.
export function useAssignees() {
  return useQuery({
    queryKey: ["assignees"],
    queryFn: async () => {
      const [a, m] = await Promise.all([
        api.get<Paginated<User>>("/users?role=ADMIN&limit=100"),
        api.get<Paginated<User>>("/users?role=MENTOR&limit=100"),
      ]);
      return [...a.items, ...m.items].filter((u) => u.isActive);
    },
    staleTime: 5 * 60_000,
  });
}

export function FollowUp({ lead }: { lead: Pick<Lead, "nextFollowUpAt" | "stage"> }) {
  if (!lead.nextFollowUpAt) return <span className="text-faint">—</span>;
  const ymd = new Date(lead.nextFollowUpAt).toLocaleDateString("en-CA");
  const open = lead.stage !== "ENROLLED" && lead.stage !== "LOST";
  const overdue = open && ymd < todayYmd();
  const today = open && ymd === todayYmd();
  return (
    <span className={overdue ? "font-medium text-bad" : today ? "font-medium text-warn" : undefined}>
      {fmtDay(ymd)}
      {overdue ? " · overdue" : today ? " · today" : ""}
    </span>
  );
}

export function LeadsPage() {
  const [params, setParams] = useSearchParams();
  const filters = {
    search: params.get("search") ?? "",
    stage: params.get("stage") ?? "",
    followUpDue: params.get("followUpDue") === "true",
    sort: params.get("sort") ?? "newest",
    page: Number(params.get("page") ?? 1),
  };
  const [searchText, setSearchText] = useState(filters.search);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);

  const update = (patch: Record<string, string | number | boolean | undefined>) => {
    const next = { ...filters, page: 1, ...patch };
    setParams(qs({ search: next.search, stage: next.stage, followUpDue: next.followUpDue || undefined, sort: next.sort === "newest" ? undefined : next.sort, page: next.page > 1 ? next.page : undefined }), { replace: true });
  };

  const leads = useQuery({
    queryKey: ["leads", filters],
    queryFn: () => api.get<Paginated<Lead>>(`/leads${qs({ ...filters, followUpDue: filters.followUpDue || undefined, limit: 20 })}`),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader
        title="Leads"
        subtitle="Everyone who has shown interest, from first contact to enrolment."
        actions={
          <>
            <Button variant="secondary" onClick={() => setImporting(true)}>
              <Upload className="size-4" /> Import CSV
            </Button>
            <Button onClick={() => setAdding(true)}>
              <Plus className="size-4" /> Add lead
            </Button>
          </>
        }
      />

      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <form
            className="relative min-w-[200px] flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              update({ search: searchText.trim() });
            }}
          >
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-faint" />
            <Input className="pl-8" placeholder="Search name, email or phone" value={searchText} onChange={(e) => setSearchText(e.target.value)} onBlur={() => searchText.trim() !== filters.search && update({ search: searchText.trim() })} aria-label="Search leads" />
          </form>
          <Select className="w-auto" value={filters.stage} onChange={(e) => update({ stage: e.target.value })} aria-label="Stage">
            <option value="">All stages</option>
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {titleCase(s)}
              </option>
            ))}
          </Select>
          <Select className="w-auto" value={filters.sort} onChange={(e) => update({ sort: e.target.value })} aria-label="Sort">
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="name">Name A–Z</option>
            <option value="followUp">Follow-up date</option>
          </Select>
          <label className="flex h-9 items-center gap-2 rounded-md border border-line px-3 text-sm">
            <input type="checkbox" checked={filters.followUpDue} onChange={(e) => update({ followUpDue: e.target.checked })} className="accent-brand" />
            Follow-up due
          </label>
        </div>

        <QueryState query={leads}>
          {(data) =>
            data.items.length === 0 ? (
              <EmptyState title="No leads match">Try clearing the filters, or add a lead.</EmptyState>
            ) : (
              <>
                <Table>
                  <thead>
                    <tr>
                      <Th>Name</Th>
                      <Th>Stage</Th>
                      <Th>Course</Th>
                      <Th>Follow-up</Th>
                      <Th>Assigned to</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((l) => (
                      <tr key={l.id} className="hover:bg-canvas/60">
                        <Td>
                          <Link to={`/leads/${l.id}`} className="font-medium text-ink hover:text-brand">
                            {l.name}
                          </Link>
                          <div className="text-xs text-muted">{l.email}</div>
                        </Td>
                        <Td>
                          <Badge tone={stageTone(l.stage)}>{titleCase(l.stage)}</Badge>
                        </Td>
                        <Td className="text-muted">{l.courseInterest ?? "—"}</Td>
                        <Td>
                          <FollowUp lead={l} />
                        </Td>
                        <Td className="text-muted">{l.assignedTo?.name ?? "Unassigned"}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
                <div className="flex items-center justify-between">
                  <p className="px-4 py-2.5 text-sm text-muted">{data.total} leads</p>
                  <Pagination page={data.page} totalPages={data.totalPages} onPage={(p) => update({ page: p })} />
                </div>
              </>
            )
          }
        </QueryState>
      </Card>

      <AddLeadModal open={adding} onClose={() => setAdding(false)} />
      <ImportModal open={importing} onClose={() => setImporting(false)} />
    </>
  );
}

function AddLeadModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const assignees = useAssignees();
  const empty = { name: "", email: "", phone: "", source: "", courseInterest: "", nextFollowUpAt: "", assignedToId: "" };
  const [form, setForm] = useState(empty);
  const create = useMutation({
    mutationFn: () => api.post<{ lead: Lead }>("/leads", { ...form, assignedToId: form.assignedToId || undefined }),
    onSuccess: ({ lead }) => {
      qc.invalidateQueries({ queryKey: ["leads"] });
      setForm(empty);
      onClose();
      navigate(`/leads/${lead.id}`);
    },
  });
  const fe = fieldErrorsOf(create.error);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  const duplicateId = (create.error as { details?: { existingLeadId?: string } } | null)?.details?.existingLeadId;

  return (
    <Modal open={open} onClose={onClose} title="Add a lead">
      <form
        className="space-y-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <TextField label="Name" required value={form.name} onChange={set("name")} error={fe.name} />
        <TextField label="Email" type="email" required value={form.email} onChange={set("email")} error={fe.email} />
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Phone" value={form.phone} onChange={set("phone")} error={fe.phone} />
          <TextField label="Source" placeholder="Website, Referral…" value={form.source} onChange={set("source")} error={fe.source} />
          <TextField label="Course interest" value={form.courseInterest} onChange={set("courseInterest")} error={fe.courseInterest} />
          <TextField label="Next follow-up" type="date" value={form.nextFollowUpAt} onChange={set("nextFollowUpAt")} error={fe.nextFollowUpAt} />
        </div>
        <Field label="Assign to">
          <Select value={form.assignedToId} onChange={set("assignedToId")}>
            <option value="">Unassigned</option>
            {assignees.data?.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({titleCase(u.role)})
              </option>
            ))}
          </Select>
        </Field>
        {Object.keys(fe).length === 0 && <ErrorBox error={create.error} />}
        {duplicateId && (
          <Link to={`/leads/${duplicateId}`} onClick={onClose} className="block text-sm font-medium text-brand hover:underline">
            Open the existing lead
          </Link>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={create.isPending}>
            Add lead
          </Button>
        </div>
      </form>
    </Modal>
  );
}

interface ImportResult {
  totalRows: number;
  imported: number;
  skipped: number;
  errors: { row: number; email?: string; reason: string }[];
  errorsTruncated: boolean;
}

function ImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const run = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.append("file", file!);
      return api.upload<ImportResult>("/leads/import", form);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leads"] }),
  });
  const close = () => {
    setFile(null);
    run.reset();
    onClose();
  };
  const result = run.data;

  return (
    <Modal open={open} onClose={close} title="Import leads from CSV" wide>
      {!result ? (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            One lead per row. Columns: <code>name</code>, <code>email</code> (required), <code>phone</code>, <code>source</code>, <code>course</code>, <code>follow up</code>. Up to 2 MB / 5,000 rows.
            Valid rows are imported and the rest are listed with the reason.
          </p>
          <input type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-sm" />
          <ErrorBox error={run.error} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button disabled={!file} loading={run.isPending} onClick={() => run.mutate()}>
              Import
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm">
            <b>{result.imported}</b> of {result.totalRows} rows imported{result.skipped ? `, ${result.skipped} skipped` : ""}.
          </p>
          {result.errors.length > 0 && (
            <div className="max-h-64 overflow-y-auto rounded-md border border-line">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr>
                    <Th>Row</Th>
                    <Th>Email</Th>
                    <Th>Why it was skipped</Th>
                  </tr>
                </thead>
                <tbody>
                  {result.errors.map((e) => (
                    <tr key={e.row}>
                      <Td className="tabular-nums">{e.row}</Td>
                      <Td className="text-muted">{e.email ?? "—"}</Td>
                      <Td>{e.reason}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {result.errorsTruncated && <p className="text-xs text-faint">Only the first 100 problems are shown.</p>}
          <div className="flex justify-end">
            <Button onClick={close}>Done</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

