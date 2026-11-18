// Display helpers. Dates use the viewer's locale; "YYYY-MM-DD" values are
// date-only and must not be shifted by the timezone.

const dateFmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export const fmtDate = (iso: string | null | undefined) => (iso ? dateFmt.format(new Date(iso)) : "—");
export const fmtDateTime = (iso: string | null | undefined) => (iso ? dateTimeFmt.format(new Date(iso)) : "—");

// "2026-11-07" (or an ISO string at UTC midnight) shown as a calendar date.
export const fmtDay = (ymdOrIso: string | null | undefined) => {
  if (!ymdOrIso) return "—";
  const [y, m, d] = ymdOrIso.slice(0, 10).split("-").map(Number);
  return dateFmt.format(new Date(y, m - 1, d));
};

export const todayYmd = () => new Date().toLocaleDateString("en-CA");
export const ymdOffset = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString("en-CA");
};

export const fmtDuration = (ms: number | null | undefined) => {
  if (ms === null || ms === undefined) return "—";
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
};

export const fmtSeconds = (sec: number) => {
  if (sec < 60) return `${sec} sec`;
  const m = Math.round(sec / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ""}`.trim();
};

export const fmtPct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${Math.round(v * 10) / 10}%`);

export const fmtBytes = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`;

export const relative = (iso: string) => {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (Math.abs(diff) < 60) return "just now";
  if (Math.abs(diff) < 3600) return rtf.format(-Math.round(diff / 60), "minute");
  if (Math.abs(diff) < 86400) return rtf.format(-Math.round(diff / 3600), "hour");
  if (Math.abs(diff) < 86400 * 30) return rtf.format(-Math.round(diff / 86400), "day");
  return fmtDate(iso);
};

export const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");

// Money is stored in paise (integers). ₹20,000.00 -> "₹20,000"; keeps paise only when there are some.
export const fmtMoney = (paise: number | null | undefined, currency = "INR") =>
  paise === null || paise === undefined
    ? "—"
    : new Intl.NumberFormat("en-IN", { style: "currency", currency, minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 }).format(paise / 100);

/** "20000.5" (rupees typed in a form) -> 2000050 paise; "" -> null; invalid -> NaN. */
export const rupeesToPaise = (rupees: string) => (rupees.trim() === "" ? null : Math.round(Number(rupees) * 100));

/** 0 -> "0 min", 45 -> "45 min", 150 -> "2 h 30 min", 1200 -> "20 h". */
export const fmtMinutes = (minutes: number | null | undefined) => {
  if (minutes === null || minutes === undefined) return "—";
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
};
