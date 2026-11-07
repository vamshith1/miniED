import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAuth, useUser } from "../lib/auth";
import { titleCase } from "../lib/format";
import type { User } from "../lib/types";
import { Button, Card, ErrorBox, PageHeader, Spinner, TextField, fieldErrorsOf } from "../components/ui";
import { AuthShell } from "./Auth";

// Two fields that must match; the server checks the rules (8–72 characters).
function NewPasswordFields({ value, confirm, onValue, onConfirm, error }: { value: string; confirm: string; onValue: (v: string) => void; onConfirm: (v: string) => void; error?: string }) {
  const mismatch = confirm.length > 0 && confirm !== value;
  return (
    <>
      <TextField label="New password" type="password" autoComplete="new-password" required minLength={8} maxLength={72} value={value} onChange={(e) => onValue(e.target.value)} error={error} hint="At least 8 characters" />
      <TextField label="Repeat new password" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => onConfirm(e.target.value)} error={mismatch ? "The passwords don't match" : undefined} />
    </>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const send = useMutation({ mutationFn: () => api.post<{ message: string }>("/auth/forgot-password", { email: email.trim() }) });
  return (
    <AuthShell title="Forgot your password?" footer={<Link to="/login" className="font-medium text-brand hover:underline">Back to sign in</Link>}>
      {send.data ? (
        <div className="space-y-3 text-sm">
          <p>{send.data.message}</p>
          <p className="text-muted">Didn't get it? Check spam, or try again in a minute.</p>
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            send.mutate();
          }}
        >
          <p className="text-sm text-muted">Enter your account's email and we'll send you a link to choose a new password.</p>
          <TextField label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} error={fieldErrorsOf(send.error).email} />
          <Button type="submit" loading={send.isPending} className="w-full">
            Send reset link
          </Button>
        </form>
      )}
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  const { logout } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  // Check the link first, so nobody types a new password into a dead link.
  const link = useQuery({
    queryKey: ["reset-link", token],
    queryFn: () => api.get<{ email: string }>(`/auth/reset-password?token=${encodeURIComponent(token)}`),
    enabled: token.length >= 20,
    retry: false,
  });
  const reset = useMutation({
    mutationFn: () => api.post("/auth/reset-password", { token, newPassword: password }),
    // A reset signs out every session, so drop any session in this browser too
    // (it may even be someone else's) and show the sign-in page.
    onSuccess: () => {
      logout();
      navigate("/login?reset=done", { replace: true });
    },
  });

  const footer = <Link to="/login" className="font-medium text-brand hover:underline">Back to sign in</Link>;
  if (token.length < 20 || link.error) {
    return (
      <AuthShell title="This link doesn't work" footer={footer}>
        <p className="mb-4 text-sm text-muted">Reset links work once, for 1 hour. Ask for a new one and use the newest email.</p>
        <Link to="/forgot-password">
          <Button className="w-full">Send a new link</Button>
        </Link>
      </AuthShell>
    );
  }
  if (link.isPending) return <Spinner label="Checking your link…" />;

  return (
    <AuthShell title="Choose a new password" footer={footer}>
      <form
        className="space-y-4"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (password === confirm) reset.mutate();
        }}
      >
        <p className="text-sm text-muted">
          For <b className="text-ink">{link.data.email}</b>. You'll be signed out everywhere and can sign in with the new one.
        </p>
        <NewPasswordFields value={password} confirm={confirm} onValue={setPassword} onConfirm={setConfirm} error={fieldErrorsOf(reset.error).newPassword} />
        {!fieldErrorsOf(reset.error).newPassword && <ErrorBox error={reset.error} />}
        <Button type="submit" loading={reset.isPending} disabled={!password || password !== confirm} className="w-full">
          Save new password
        </Button>
      </form>
    </AuthShell>
  );
}

export function AccountPage() {
  const user = useUser();
  const { replaceSession } = useAuth();
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const change = useMutation({
    mutationFn: () => api.post<{ token: string; user: User }>("/auth/change-password", { currentPassword: current, newPassword: password }),
    onSuccess: (session) => {
      replaceSession(session); // this device stays signed in with the new token
      setCurrent("");
      setPassword("");
      setConfirm("");
    },
  });
  const fe = fieldErrorsOf(change.error);

  return (
    <>
      <PageHeader title="Account" />
      <div className="grid max-w-3xl gap-4 md:grid-cols-2">
        <Card title="Your details">
          <dl className="space-y-2 text-sm">
            {[
              ["Name", user.name],
              ["Email", user.email],
              ["Role", titleCase(user.role)],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-muted">{k}</dt>
                <dd className="font-medium">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-faint">To change your name or email, ask an admin.</p>
        </Card>
        <Card title="Change password">
          <form
            className="space-y-3"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              if (password === confirm) change.mutate();
            }}
          >
            <TextField label="Current password" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} error={fe.currentPassword} />
            <NewPasswordFields value={password} confirm={confirm} onValue={setPassword} onConfirm={setConfirm} error={fe.newPassword} />
            {Object.keys(fe).length === 0 && <ErrorBox error={change.error} />}
            {change.isSuccess && (
              <p className="text-sm text-good" role="status">
                Password changed. Your other devices were signed out.
              </p>
            )}
            <Button type="submit" loading={change.isPending} disabled={!current || !password || password !== confirm}>
              Change password
            </Button>
          </form>
        </Card>
      </div>
    </>
  );
}
