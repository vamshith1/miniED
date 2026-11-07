import { useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { BookOpen } from "lucide-react";
import { homePathFor, useAuth } from "../lib/auth";
import { Button, ErrorBox, TextField, fieldErrorsOf } from "../components/ui";

// Only follow ?next= to pages inside this app.
const safeNext = (next: string | null) => (next && next.startsWith("/") && !next.startsWith("//") ? next : null);

export function AuthShell({ title, children, footer }: { title: string; children: ReactNode; footer: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2">
          <span className="grid size-9 place-items-center rounded-lg bg-brand text-white">
            <BookOpen className="size-5" />
          </span>
          <span className="text-lg font-semibold">MiniEdCRM</span>
        </div>
        <div className="rounded-lg border border-line bg-surface p-6">
          <h1 className="mb-4 text-lg font-semibold">{title}</h1>
          {children}
        </div>
        <p className="mt-4 text-center text-sm text-muted">{footer}</p>
      </div>
    </div>
  );
}

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={safeNext(params.get("next")) ?? homePathFor(user.role)} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const u = await login(email.trim(), password);
      navigate(safeNext(params.get("next")) ?? homePathFor(u.role), { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Sign in" footer={<>New student? <Link to="/signup" className="font-medium text-brand hover:underline">Create an account</Link></>}>
      {params.get("reset") === "done" && (
        <p className="mb-4 rounded-md border border-good/30 bg-good-soft px-3 py-2 text-sm text-good" role="status">
          Password updated. Sign in with your new password.
        </p>
      )}
      <form onSubmit={submit} className="space-y-4">
        <TextField label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <TextField label="Password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <div className="-mt-2 text-right">
          <Link to="/forgot-password" className="text-sm text-brand hover:underline">
            Forgot password?
          </Link>
        </div>
        <ErrorBox error={error} />
        <Button type="submit" loading={busy} className="w-full">
          Sign in
        </Button>
      </form>
    </AuthShell>
  );
}

export function SignupPage() {
  const { user, signup } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const fe = fieldErrorsOf(error);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  if (user) return <Navigate to={homePathFor(user.role)} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const u = await signup({ name: form.name.trim(), email: form.email.trim(), password: form.password });
      navigate(homePathFor(u.role), { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Create a student account" footer={<>Already have an account? <Link to="/login" className="font-medium text-brand hover:underline">Sign in</Link></>}>
      <form onSubmit={submit} className="space-y-4">
        <TextField label="Full name" autoComplete="name" required value={form.name} onChange={set("name")} error={fe.name} />
        <TextField label="Email" type="email" autoComplete="email" required value={form.email} onChange={set("email")} error={fe.email} />
        <TextField label="Password" type="password" autoComplete="new-password" required minLength={8} value={form.password} onChange={set("password")} error={fe.password} hint="At least 8 characters" />
        {Object.keys(fe).length === 0 && <ErrorBox error={error} />}
        <Button type="submit" loading={busy} className="w-full">
          Create account
        </Button>
      </form>
    </AuthShell>
  );
}
