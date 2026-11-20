import { useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { BookOpen, Briefcase, PenLine, Rocket, UserRoundSearch } from "lucide-react";
import { homePathFor, useAuth } from "../lib/auth";
import { Button, ErrorBox, TextField, fieldErrorsOf } from "../components/ui";

// Only follow ?next= to pages inside this app.
const safeNext = (next: string | null) => (next && next.startsWith("/") && !next.startsWith("//") ? next : null);

const FEATURES = [
  { icon: <UserRoundSearch className="size-4" />, title: "Leads to students", text: "Follow-ups, enrolment and fee payments" },
  { icon: <PenLine className="size-4" />, title: "Quizzes that teach", text: "Timed tests, practice sets and skill gaps" },
  { icon: <Rocket className="size-4" />, title: "Placement readiness", text: "One score from quizzes, attendance and tasks" },
  { icon: <Briefcase className="size-4" />, title: "Jobs and campus drives", text: "Recruiters, hiring tests and interviews" },
];

// Soft purple light behind the panel and the form. Purely decorative.
function Glow({ className }: { className: string }) {
  return <div aria-hidden className={`pointer-events-none absolute rounded-full blur-3xl motion-safe:animate-glow ${className}`} />;
}

function Logo({ light }: { light?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid size-9 place-items-center rounded-lg bg-linear-to-br from-brand to-brand-deep text-white shadow-lg shadow-brand/40 ring-1 ring-white/20">
        <BookOpen className="size-5" />
      </span>
      <span className={light ? "text-lg font-semibold text-white" : "text-lg font-semibold text-ink"}>MiniEdCRM</span>
    </div>
  );
}

/** The purple brand panel on the left of the sign-in pages (wide screens only). */
function BrandPanel() {
  return (
    <aside className="relative hidden overflow-hidden bg-[#1e0b3d] md:flex md:flex-col md:justify-between md:p-8 lg:p-12">
      <Glow className="-left-24 -top-24 size-96 bg-brand/50" />
      <Glow className="-bottom-32 right-[-6rem] size-[28rem] bg-fuchsia-500/30 [animation-delay:-7s]" />
      <Glow className="left-1/3 top-1/2 size-72 bg-indigo-500/25 [animation-delay:-3s]" />
      {/* A faint grid, fading out towards the bottom */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(white_1px,transparent_1px),linear-gradient(90deg,white_1px,transparent_1px)] [background-size:44px_44px] [mask-image:linear-gradient(to_bottom,black,transparent_85%)]"
      />

      <div className="relative">
        <Logo light />
      </div>

      <div className="relative max-w-md">
        <h2 className="text-3xl font-semibold lg:text-4xl leading-tight tracking-tight text-white">
          From first enquiry to{" "}
          <span className="bg-linear-to-r from-violet-300 to-fuchsia-300 bg-clip-text text-transparent">first job offer.</span>
        </h2>
        <p className="mt-4 text-base text-violet-200/80">Leads, batches, quizzes and placements for your institute, in one place.</p>

        <ul className="mt-8 grid gap-3 lg:grid-cols-2">
          {FEATURES.map((f) => (
            <li key={f.title} className="rounded-xl border border-white/10 bg-white/[0.06] p-3.5 backdrop-blur-sm transition-colors hover:border-violet-300/40 hover:bg-white/10">
              <span className="mb-2 grid size-8 place-items-center rounded-lg bg-violet-400/20 text-violet-200">{f.icon}</span>
              <p className="text-sm font-medium text-white">{f.title}</p>
              <p className="mt-0.5 text-xs text-violet-200/70">{f.text}</p>
            </li>
          ))}
        </ul>
      </div>

      <p className="relative text-xs text-violet-200/60">Students, mentors, recruiters and admins sign in here.</p>
    </aside>
  );
}

/** On narrow screens the panel becomes a compact purple header above the form. */
function BrandHeader() {
  return (
    <header className="relative overflow-hidden rounded-b-3xl bg-[#1e0b3d] px-6 pb-8 pt-7 md:hidden">
      <Glow className="-left-16 -top-20 size-64 bg-brand/50" />
      <Glow className="-bottom-24 -right-16 size-64 bg-fuchsia-500/30 [animation-delay:-7s]" />
      <div className="relative">
        <Logo light />
        <p className="mt-5 text-2xl font-semibold leading-tight text-white">
          From first enquiry to{" "}
          <span className="bg-linear-to-r from-violet-300 to-fuchsia-300 bg-clip-text text-transparent">first job offer.</span>
        </p>
        <p className="mt-2 text-sm text-violet-200/80">Leads, batches, quizzes and placements in one place.</p>
      </div>
    </header>
  );
}

export function AuthShell({ title, children, footer }: { title: string; children: ReactNode; footer: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <BrandPanel />
      <BrandHeader />
      <main className="relative flex flex-1 items-center justify-center overflow-hidden px-4 py-10">
        {/* A purple glow behind the form, so the card seems lit from behind */}
        <Glow className="left-1/2 top-1/2 size-[26rem] -translate-x-1/2 -translate-y-1/2 bg-brand/20" />
        <div className="animate-fade-up relative w-full max-w-sm">
          <div className="rounded-2xl border border-line bg-surface/90 p-7 shadow-2xl shadow-brand/15 ring-1 ring-brand/10 backdrop-blur">
            <h1 className="text-xl font-semibold">{title}</h1>
            <div className="mb-5 mt-1 h-1 w-10 rounded-full bg-linear-to-r from-brand to-fuchsia-400" aria-hidden />
            {children}
          </div>
          <p className="mt-5 text-center text-sm text-muted">{footer}</p>
        </div>
      </main>
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
    <AuthShell title="Welcome back" footer={<>New student? <Link to="/signup" className="font-medium text-brand hover:underline">Create an account</Link></>}>
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
