import { useEffect, useState } from "react";

// Chart colours come from theme variables (index.css), so charts follow light and dark mode.
export const SERIES_1 = "var(--chart-1)";
export const SERIES_2 = "var(--chart-2)";
export const HOVER_BAR = "var(--chart-1-hover)"; // a hovered bar changes shade
export const CURSOR = "var(--chart-cursor)"; // the column behind the pointer
export const GRID = "var(--chart-grid)";
export const AXIS_TEXT = "var(--chart-axis)";
export const TICK = { fill: AXIS_TEXT, fontSize: 12 };

// How long the pointer must stay still before a chart tooltip appears.
const TOOLTIP_REST_MS = 300;

// One tooltip style for every chart: text in ink colours, a swatch carries the series identity.
// It stays hidden while the pointer moves and fades in once it rests, so it doesn't chase the cursor.
export function ChartTooltip({
  active,
  payload,
  label,
  format,
  coordinate,
}: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
  format?: (v: number) => string;
  coordinate?: { x?: number; y?: number };
}) {
  const [resting, setResting] = useState(false);
  const x = Math.round(coordinate?.x ?? 0);
  const y = Math.round(coordinate?.y ?? 0);
  useEffect(() => {
    setResting(false);
    if (!active) return;
    const id = setTimeout(() => setResting(true), TOOLTIP_REST_MS);
    return () => clearTimeout(id);
  }, [active, x, y, label]);
  if (!active || !payload?.length || !resting) return null;
  return (
    <div className="animate-fade-in rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium text-ink">{label}</p>
      {payload.map((p) => (
        <p key={p.name} className="flex items-center gap-2 text-muted">
          <span className="size-2.5 rounded-sm" style={{ background: p.color }} />
          {p.name}: <span className="font-medium tabular-nums text-ink">{format ? format(p.value) : p.value}</span>
        </p>
      ))}
    </div>
  );
}

// Legend in the same order as the bars (Recharts would sort it alphabetically).
export function SeriesLegend({ items }: { items: { name: string; color: string }[] }) {
  return (
    <ul className="flex justify-center gap-4 pt-1 text-xs text-muted">
      {items.map((i) => (
        <li key={i.name} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: i.color }} /> {i.name}
        </li>
      ))}
    </ul>
  );
}
