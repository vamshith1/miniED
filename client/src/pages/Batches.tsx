import { useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Plus, Users } from "lucide-react";
import { api } from "../lib/api";
import { useUser } from "../lib/auth";
import { fmtDay, fmtMoney, rupeesToPaise, todayYmd } from "../lib/format";
import type { Batch, Paginated, User } from "../lib/types";
import { Badge, Button, EmptyState, ErrorBox, Field, Modal, PageHeader, QueryState, Select, TextField, fieldErrorsOf } from "../components/ui";

export const batchStatus = (b: Pick<Batch, "startDate" | "endDate">) => {
  const today = todayYmd();
  if (b.startDate.slice(0, 10) > today) return { label: "Starts soon", tone: "brand" as const };
  if (b.endDate && b.endDate.slice(0, 10) < today) return { label: "Finished", tone: "neutral" as const };
  return { label: "Running", tone: "good" as const };
};

export function useMentors(enabled = true) {
  return useQuery({
    queryKey: ["mentors"],
    queryFn: () => api.get<Paginated<User>>("/users?role=MENTOR&limit=100").then((r) => r.items.filter((u) => u.isActive)),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function BatchesPage() {
  const user = useUser();
  const isAdmin = user.role === "ADMIN";
  const [creating, setCreating] = useState(false);
  const batches = useQuery({ queryKey: ["batches"], queryFn: () => api.get<{ items: Batch[] }>("/batches").then((r) => r.items) });

  return (
    <>
      <PageHeader
        title={isAdmin ? "Batches" : "My batches"}
        subtitle={isAdmin ? "Every cohort, its mentor and students." : "The batches you mentor: attendance, quizzes and students."}
        actions={
          isAdmin && (
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" /> New batch
            </Button>
          )
        }
      />
      <QueryState query={batches}>
        {(items) =>
          items.length === 0 ? (
            <div className="rounded-lg border border-line bg-surface">
              <EmptyState title={isAdmin ? "No batches yet" : "You aren't mentoring a batch yet"}>{isAdmin ? "Create one to start enrolling students." : "An admin assigns mentors to batches."}</EmptyState>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((b) => {
                const s = batchStatus(b);
                return (
                  <Link key={b.id} to={`/batches/${b.id}`} className="group rounded-lg border border-line bg-surface p-4 transition-colors hover:border-brand/40">
                    <div className="flex items-start justify-between gap-2">
                      <h2 className="font-semibold text-ink group-hover:text-brand">{b.name}</h2>
                      <Badge tone={s.tone}>{s.label}</Badge>
                    </div>
                    <p className="text-sm text-muted">{b.course}</p>
                    <div className="mt-3 space-y-1 text-sm text-muted">
                      <p className="flex items-center gap-1.5">
                        <CalendarDays className="size-4 text-faint" /> {fmtDay(b.startDate)}
                        {b.endDate ? ` – ${fmtDay(b.endDate)}` : " onwards"}
                      </p>
                      <p className="flex items-center gap-1.5">
                        <Users className="size-4 text-faint" /> {b._count.students} student{b._count.students === 1 ? "" : "s"}
                        {isAdmin && ` · ${b.mentor ? b.mentor.name : "no mentor"}`}
                      </p>
                    </div>
                  </Link>
                );
              })}
            </div>
          )
        }
      </QueryState>
      {isAdmin && <BatchFormModal open={creating} onClose={() => setCreating(false)} />}
    </>
  );
}

// Create (no batch) or edit (batch given).
export function BatchFormModal({ open, onClose, batch }: { open: boolean; onClose: () => void; batch?: Batch }) {
  const qc = useQueryClient();
  const mentors = useMentors(open);
  const initial = {
    name: batch?.name ?? "",
    course: batch?.course ?? "",
    startDate: batch?.startDate.slice(0, 10) ?? todayYmd(),
    endDate: batch?.endDate?.slice(0, 10) ?? "",
    mentorId: batch?.mentorId ?? "",
    fee: batch?.feePaise != null ? String(batch.feePaise / 100) : "",
  };
  const [form, setForm] = useState(initial);
  const save = useMutation({
    mutationFn: () => {
      const { fee, ...fields } = form;
      const feePaise = rupeesToPaise(fee);
      return batch
        ? api.patch(`/batches/${batch.id}`, { ...fields, endDate: form.endDate || null, mentorId: form.mentorId || null, feePaise })
        : api.post("/batches", { ...fields, endDate: form.endDate || undefined, mentorId: form.mentorId || undefined, feePaise: feePaise ?? undefined });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["batches"] });
      if (batch) qc.invalidateQueries({ queryKey: ["batch", batch.id] });
      if (!batch) setForm(initial);
      onClose();
    },
  });
  const fe = fieldErrorsOf(save.error);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  return (
    <Modal open={open} onClose={onClose} title={batch ? "Edit batch" : "New batch"}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <TextField label="Name" placeholder="FS-Web-Jan-2027" required value={form.name} onChange={set("name")} error={fe.name} />
        <TextField label="Course" placeholder="Full Stack Web" required value={form.course} onChange={set("course")} error={fe.course} />
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Start date" type="date" required value={form.startDate} onChange={set("startDate")} error={fe.startDate} />
          <TextField label="End date (optional)" type="date" min={form.startDate} value={form.endDate} onChange={set("endDate")} error={fe.endDate} />
        </div>
        <TextField
          label="Course fee in ₹ (optional)"
          type="number"
          min={0}
          step="0.01"
          inputMode="decimal"
          placeholder="20000"
          value={form.fee}
          onChange={set("fee")}
          error={fe.feePaise}
          hint={form.fee && Number(form.fee) > 0 ? `Enrolling asks for ${fmtMoney(rupeesToPaise(form.fee))}, or can skip payment.` : "Leave empty for no fee."}
        />
        <Field label="Mentor" error={fe.mentorId}>
          <Select value={form.mentorId} onChange={set("mentorId")}>
            <option value="">No mentor yet</option>
            {mentors.data?.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
        {Object.keys(fe).length === 0 && <ErrorBox error={save.error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending}>
            {batch ? "Save" : "Create batch"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
