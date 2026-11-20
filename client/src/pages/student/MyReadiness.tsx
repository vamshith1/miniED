import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Rocket } from "lucide-react";
import { api } from "../../lib/api";
import { fmtPct } from "../../lib/format";
import type { Readiness, ReadinessWeights } from "../../lib/types";
import { Badge, Card, QueryState } from "../../components/ui";
import { BandBadge, ReadinessMeter, weightsText } from "../../components/Readiness";

/** The student's placement readiness on their home page, with what it's made of. */
export function MyReadinessCard() {
  const r = useQuery({ queryKey: ["placement", "me"], queryFn: () => api.get<Readiness & { weights: ReadinessWeights }>("/placement/me") });
  return (
    <Card
      className="mb-4"
      title={
        <span className="flex items-center gap-2">
          <Rocket className="size-4 text-brand-strong" /> Placement readiness
        </span>
      }
    >
      <QueryState query={r}>
        {(x) => (
          <div className="grid gap-4 md:grid-cols-[180px_1fr]">
            <div>
              <ReadinessMeter value={x.readiness} band={x.band} className="[&>div:first-child]:text-3xl" />
              <div className="mt-2">
                <BandBadge band={x.band} />
              </div>
            </div>
            <div className="space-y-2 text-sm">
              <div className="grid grid-cols-3 gap-2">
                <Part label="Quizzes" value={fmtPct(x.quizAverage)} hint={`${x.quizzesTaken} taken`} to="/my-quizzes" />
                <Part label="Attendance" value={fmtPct(x.attendance)} hint={`${x.daysMarked} days marked`} to="/my-attendance" />
                <Part label="Tasks" value={x.tasksDue ? `${x.tasksAccepted}/${x.tasksDue}` : "—"} hint="accepted / due" to="/my-tasks" />
              </div>
              {x.gaps.length > 0 && (
                <p className="flex flex-wrap items-center gap-1">
                  <span className="text-muted">Work on:</span>
                  {x.gaps.map((g) => (
                    <Badge key={g} tone="bad">
                      {g}
                    </Badge>
                  ))}
                </p>
              )}
              <p className="text-xs text-faint">{weightsText(x.weights)}</p>
            </div>
          </div>
        )}
      </QueryState>
    </Card>
  );
}

function Part({ label, value, hint, to }: { label: string; value: string; hint: string; to: string }) {
  return (
    <Link to={to} className="rounded-md border border-line px-3 py-2 transition-colors hover:border-brand/40 hover:bg-brand-soft/40">
      <p className="text-xs text-muted">{label}</p>
      <p className="font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-faint">{hint}</p>
    </Link>
  );
}
