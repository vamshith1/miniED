import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { Eye, EyeOff, Loader2, X } from "lucide-react";
import { ApiError } from "../lib/api";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

// ---------- Buttons

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  loading?: boolean;
};

export function Button({ variant = "primary", size = "md", loading, disabled, className, children, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx(
        // Hover lifts the button a little and deepens its colour; pressing pushes it back down.
        // Disabled buttons stay flat so they don't look clickable.
        "inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-full font-medium select-none",
        "transition-all duration-150 ease-out enabled:hover:-translate-y-px enabled:active:translate-y-0 enabled:active:scale-[0.97]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-1",
        "disabled:cursor-not-allowed disabled:opacity-55",
        size === "sm" ? "h-8 px-3 text-sm" : "h-9 px-4 text-sm",
        variant === "primary" &&
          "bg-brand text-white shadow-sm shadow-brand/25 enabled:hover:bg-brand-deep enabled:hover:shadow-md enabled:hover:shadow-brand/35",
        variant === "secondary" &&
          "border border-line bg-surface text-ink shadow-xs enabled:hover:border-brand/40 enabled:hover:bg-brand-soft/50 enabled:hover:text-brand-strong enabled:hover:shadow-sm",
        variant === "ghost" && "text-muted enabled:hover:bg-brand-soft/60 enabled:hover:text-brand-strong",
        variant === "danger" && "border border-bad/30 bg-surface text-bad enabled:hover:border-bad/60 enabled:hover:bg-bad-soft enabled:hover:shadow-sm",
        className,
      )}
    >
      {/* While loading, the spinner replaces any leading icon instead of sitting next to it */}
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      <span className={cx("contents", loading && "[&>svg:first-child]:hidden")}>{children}</span>
    </button>
  );
}

// ---------- Form fields

export function Field({ label, error, hint, children, htmlFor }: { label: string; error?: string; hint?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-ink">
        {label}
      </label>
      {children}
      {error ? <p className="text-xs text-bad">{error}</p> : hint ? <p className="text-xs text-faint">{hint}</p> : null}
    </div>
  );
}

// Full width unless the caller sets a width (w-auto, w-16...).
const width = (className?: string) => (/(^|\s)w-/.test(className ?? "") ? "" : "w-full");
const control = "rounded-md border border-line bg-surface px-3 text-sm text-ink placeholder:text-faint focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:bg-canvas";

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cx(control, width(className), "h-9", className)} />;
}
export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={cx(control, width(className), "py-2", className)} />;
}
export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={cx(control, width(className), "h-9 pr-8", className)}>
      {children}
    </select>
  );
}

// Labelled input in one line, the common case.
export function TextField({ label, error, hint, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: string }) {
  const id = useId();
  return (
    <Field label={label} error={error} hint={hint} htmlFor={id}>
      {rest.type === "password" ? <PasswordInput id={id} aria-invalid={!!error} {...rest} /> : <Input id={id} aria-invalid={!!error} {...rest} />}
    </Field>
  );
}

/**
 * A password box with a show/hide button, so people can check what they typed
 * (handy when choosing a new password). It starts hidden every time.
 */
export function PasswordInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  const [shown, setShown] = useState(false);
  const Icon = shown ? EyeOff : Eye;
  return (
    <div className="relative">
      <Input {...rest} type={shown ? "text" : "password"} className={cx("pr-10", className)} />
      <button
        type="button" // never submits the form
        onClick={() => setShown(!shown)}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-muted transition-colors hover:text-brand-strong focus-visible:text-brand-strong"
        aria-label={shown ? "Hide password" : "Show password"}
        aria-pressed={shown}
        title={shown ? "Hide password" : "Show password"}
      >
        <Icon className="size-4" />
      </button>
    </div>
  );
}

// ---------- Layout pieces

export function Card({ title, actions, children, className, padded = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={cx("rounded-lg border border-line bg-surface", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          {title && <h2 className="text-sm font-semibold text-ink">{title}</h2>}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={padded ? "p-4" : undefined}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="truncate text-xl font-semibold text-ink">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

type Tone = "neutral" | "brand" | "good" | "warn" | "bad";
const toneClass: Record<Tone, string> = {
  neutral: "bg-canvas text-muted border-line",
  brand: "bg-brand-soft text-brand-strong border-brand/20",
  good: "bg-good-soft text-good border-good/20",
  warn: "bg-warn-soft text-warn border-warn/20",
  bad: "bg-bad-soft text-bad border-bad/20",
};
export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cx("inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium", toneClass[tone])}>{children}</span>;
}

export const stageTone = (s: string): Tone =>
  s === "ENROLLED" ? "good" : s === "LOST" ? "bad" : s === "INTERESTED" ? "brand" : s === "CONTACTED" ? "warn" : "neutral";

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted" role="status">
      <Loader2 className="size-4 animate-spin" aria-hidden /> {label}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-4 py-10 text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
      {children && <div className="mt-1 text-sm text-muted">{children}</div>}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : "Something went wrong";
  return (
    <div role="alert" className="rounded-md border border-bad/30 bg-bad-soft px-3 py-2 text-sm text-bad">
      {message}
    </div>
  );
}

// Field errors from a failed mutation, keyed by field name.
export const fieldErrorsOf = (err: unknown) => (err instanceof ApiError ? err.fieldErrors() : {});

// Shows a query's loading / error state, or renders children with its data.
export function QueryState<T>({ query, children }: { query: { data?: T; error: unknown; isPending: boolean }; children: (data: T) => ReactNode }) {
  if (query.isPending) return <Spinner />;
  if (query.error) return <div className="p-4"><ErrorBox error={query.error} /></div>;
  return <>{children(query.data as T)}</>;
}

export function Pagination({ page, totalPages, onPage }: { page: number; totalPages: number; onPage: (p: number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-2.5 text-sm text-muted">
      <span>
        Page {page} of {totalPages}
      </span>
      <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </Button>
      <Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
        Next
      </Button>
    </div>
  );
}

// Big number with a label, for dashboards.
export function Stat({
  label,
  value,
  hint,
  tone,
  icon,
  interactive,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "bad" | "good";
  icon?: ReactNode;
  interactive?: boolean; // wrapped in a link: show it reacts to the pointer
}) {
  return (
    <div
      className={cx(
        "group h-full rounded-lg border border-line bg-surface p-4 transition-all duration-200",
        interactive && "hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-md hover:shadow-brand/10",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
        {icon && (
          <span
            className={cx(
              "grid size-8 shrink-0 place-items-center rounded-md transition-transform duration-200 group-hover:scale-110",
              tone === "bad" ? "bg-bad-soft text-bad" : tone === "good" ? "bg-good-soft text-good" : "bg-brand-soft text-brand-strong",
            )}
          >
            {icon}
          </span>
        )}
      </div>
      <p className={cx("mt-1 text-2xl font-semibold tabular-nums", tone === "bad" ? "text-bad" : tone === "good" ? "text-good" : "text-ink")}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-faint">{hint}</p>}
    </div>
  );
}

/**
 * Counts up from the previous value to `value` (from 0 on first show), so changes on
 * the dashboard are visible. Shows "—" for null.
 */
export function AnimatedNumber({ value, format = (n) => Math.round(n).toLocaleString(), duration = 700 }: { value: number | null; format?: (n: number) => string; duration?: number }) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    if (value === null) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const start = from.current;
    if (reduce || start === value) {
      from.current = value;
      setShown(value);
      return;
    }
    const t0 = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(start + (value - start) * eased);
      if (p < 1) frame = requestAnimationFrame(step);
      else from.current = value;
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      from.current = value;
    };
  }, [value, duration]);
  return <>{value === null ? "—" : format(shown)}</>;
}

// ---------- Tables

// "relative" keeps absolutely positioned bits (like sr-only labels) inside the scroll box,
// otherwise they escape it and make the whole page scroll sideways.
export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full min-w-[560px] text-left text-sm [&_tbody_tr]:transition-colors [&_tbody_tr:hover]:bg-brand-soft/40">{children}</table>
    </div>
  );
}
export const Th = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <th className={cx("border-b border-line bg-canvas/60 px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted", className)}>{children}</th>
);
export const Td = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <td className={cx("border-b border-line px-4 py-2.5 align-middle", className)}>{children}</td>
);

// ---------- Modal (native <dialog>: focus trap and Esc for free)

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={cx("m-auto w-[calc(100%-2rem)] rounded-lg border border-line bg-surface p-0 text-ink shadow-xl backdrop:bg-black/55", wide ? "max-w-2xl" : "max-w-md")}
    >
      {open && (
        <div>
          <header className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-base font-semibold">{title}</h2>
            <button onClick={onClose} className="rounded p-1 text-muted hover:bg-canvas hover:text-ink" aria-label="Close">
              <X className="size-4" />
            </button>
          </header>
          <div className="max-h-[75vh] overflow-y-auto p-4">{children}</div>
        </div>
      )}
    </dialog>
  );
}

// ---------- Confirmation dialog

type ConfirmRequest = { message: string; confirmLabel: string; danger: boolean; resolve: (ok: boolean) => void };
let showConfirm: ((r: ConfirmRequest) => void) | null = null;

/**
 * Asks "are you sure?" in the app's own dialog and resolves to true or false.
 * Used instead of window.confirm(), which some embedded browsers block (it then
 * returns false at once, so the action silently never happens).
 */
export function askConfirm(message: string, opts: { confirmLabel?: string; danger?: boolean } = {}) {
  return new Promise<boolean>((resolve) => {
    if (!showConfirm) return resolve(window.confirm(message)); // ConfirmHost isn't mounted (shouldn't happen)
    showConfirm({ message, confirmLabel: opts.confirmLabel ?? "Confirm", danger: opts.danger ?? false, resolve });
  });
}

/** Rendered once at the app root; shows the dialogs that askConfirm() requests. */
export function ConfirmHost() {
  const [req, setReq] = useState<ConfirmRequest | null>(null);
  useEffect(() => {
    showConfirm = (r) =>
      setReq((current) => {
        current?.resolve(false); // a newer question replaces an unanswered one
        return r;
      });
    return () => {
      showConfirm = null;
    };
  }, []);
  const answer = (ok: boolean) => {
    req?.resolve(ok);
    setReq(null);
  };
  return (
    <Modal open={!!req} onClose={() => answer(false)} title="Are you sure?">
      <p className="text-sm">{req?.message}</p>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={() => answer(false)}>
          Cancel
        </Button>
        <Button variant={req?.danger ? "danger" : "primary"} onClick={() => answer(true)} autoFocus>
          {req?.confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (t: T) => void }) {
  return (
    // overflow-y-hidden: the active tab's underline overlaps the border by 1px, which otherwise adds a vertical scrollbar.
    <div role="tablist" className="mb-4 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-line">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cx(
            "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium",
            value === t.id ? "border-brand text-brand" : "border-transparent text-muted hover:text-ink",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export { cx };
