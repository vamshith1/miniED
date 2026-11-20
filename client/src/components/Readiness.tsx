import type { ReadinessBand } from "../lib/types";
import { fmtPct } from "../lib/format";
import { Badge, cx } from "./ui";

export const bandInfo: Record<ReadinessBand, { label: string; tone: "good" | "warn" | "bad"; bar: string }> = {
  READY: { label: "Ready", tone: "good", bar: "bg-good" },
  ALMOST: { label: "Almost ready", tone: "warn", bar: "bg-warn" },
  NEEDS_WORK: { label: "Needs work", tone: "bad", bar: "bg-bad" },
};

export function BandBadge({ band }: { band: ReadinessBand | null }) {
  return band ? <Badge tone={bandInfo[band].tone}>{bandInfo[band].label}</Badge> : <Badge>No data yet</Badge>;
}

/** The readiness score as a number with a small bar under it. */
export function ReadinessMeter({ value, band, className }: { value: number | null; band: ReadinessBand | null; className?: string }) {
  return (
    <div className={cx("min-w-24", className)}>
      <div className="text-sm font-semibold tabular-nums">{fmtPct(value)}</div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-canvas" aria-hidden>
        {value != null && band && <div className={cx("h-full rounded-full transition-[width] duration-700", bandInfo[band].bar)} style={{ width: `${Math.max(3, value)}%` }} />}
      </div>
    </div>
  );
}

export const weightsText = (w: { quizzes: number; attendance: number; tasks: number }) =>
  `Readiness = quiz average ${w.quizzes}% + attendance ${w.attendance}% + tasks accepted ${w.tasks}%. A part with no data yet is left out. 75%+ is ready, 50–75% almost.`;
