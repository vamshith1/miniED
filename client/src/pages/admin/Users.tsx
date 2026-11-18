import { useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { api, qs } from "../../lib/api";
import { useUser } from "../../lib/auth";
import { fmtDate, titleCase } from "../../lib/format";
import type { Paginated, Role, User } from "../../lib/types";
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Modal, PageHeader, Pagination, QueryState, Select, Table, Td, TextField, Th, Tabs, fieldErrorsOf, askConfirm } from "../../components/ui";

type Filter = "ALL" | Role;

export function UsersPage() {
  const me = useUser();
  const qc = useQueryClient();
  const [role, setRole] = useState<Filter>("ALL");
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const users = useQuery({
    queryKey: ["users", role, page],
    queryFn: () => api.get<Paginated<User>>(`/users${qs({ role: role === "ALL" ? undefined : role, page, limit: 20 })}`),
    placeholderData: keepPreviousData,
  });
  const toggle = useMutation({
    mutationFn: (u: User) => api.patch(`/users/${u.id}/status`, { isActive: !u.isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });

  return (
    <>
      <PageHeader
        title="Users"
        subtitle="Admins, mentors and students. Deactivated accounts can't sign in."
        actions={
          <Button onClick={() => setAdding(true)}>
            <Plus className="size-4" /> Add user
          </Button>
        }
      />
      <Tabs<Filter>
        value={role}
        onChange={(r) => {
          setRole(r);
          setPage(1);
        }}
        tabs={[
          { id: "ALL", label: "Everyone" },
          { id: "ADMIN", label: "Admins" },
          { id: "MENTOR", label: "Mentors" },
          { id: "STUDENT", label: "Students" },
        ]}
      />
      <ErrorBox error={toggle.error} />
      <Card padded={false}>
        <QueryState query={users}>
          {(data) =>
            data.items.length === 0 ? (
              <EmptyState title="No users here yet" />
            ) : (
              <>
                <Table>
                  <thead>
                    <tr>
                      <Th>Name</Th>
                      <Th>Role</Th>
                      <Th>Joined</Th>
                      <Th>Status</Th>
                      <Th className="text-right">Action</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((u) => (
                      <tr key={u.id}>
                        <Td>
                          <div className="font-medium">{u.name}</div>
                          <div className="text-xs text-muted">{u.email}</div>
                        </Td>
                        <Td>{titleCase(u.role)}</Td>
                        <Td className="text-muted">{fmtDate(u.createdAt)}</Td>
                        <Td>{u.isActive ? <Badge tone="good">Active</Badge> : <Badge tone="bad">Deactivated</Badge>}</Td>
                        <Td className="text-right">
                          {u.id !== me.id && (
                            <Button
                              size="sm"
                              variant={u.isActive ? "danger" : "secondary"}
                              loading={toggle.isPending && toggle.variables?.id === u.id}
                              onClick={async () => (!u.isActive || (await askConfirm(`Deactivate ${u.name}? They'll be signed out and can't sign in.`, { confirmLabel: "Deactivate", danger: true }))) && toggle.mutate(u)}
                            >
                              {u.isActive ? "Deactivate" : "Reactivate"}
                            </Button>
                          )}
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
      <AddUserModal open={adding} onClose={() => setAdding(false)} />
    </>
  );
}

function AddUserModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const empty = { name: "", email: "", phone: "", password: "", role: "MENTOR" as Role };
  const [form, setForm] = useState(empty);
  const create = useMutation({
    mutationFn: () => api.post("/users", { ...form, phone: form.phone || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      qc.invalidateQueries({ queryKey: ["assignees"] });
      setForm(empty);
      onClose();
    },
  });
  const fe = fieldErrorsOf(create.error);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  return (
    <Modal open={open} onClose={onClose} title="Add a user">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <Field label="Role">
          <Select value={form.role} onChange={set("role")}>
            <option value="MENTOR">Mentor</option>
            <option value="ADMIN">Admin</option>
            <option value="STUDENT">Student</option>
          </Select>
        </Field>
        <TextField label="Name" required value={form.name} onChange={set("name")} error={fe.name} />
        <TextField label="Email" type="email" required value={form.email} onChange={set("email")} error={fe.email} />
        <TextField label="Phone (optional)" value={form.phone} onChange={set("phone")} error={fe.phone} />
        <TextField label="Password" type="text" required minLength={8} value={form.password} onChange={set("password")} error={fe.password} hint="Share it with them; they get a welcome email without it." />
        {Object.keys(fe).length === 0 && <ErrorBox error={create.error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={create.isPending}>
            Add user
          </Button>
        </div>
      </form>
    </Modal>
  );
}
