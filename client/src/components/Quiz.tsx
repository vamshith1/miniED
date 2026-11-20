import { Check, Lightbulb, Tag, X } from "lucide-react";
import { fmtDuration, fmtPct } from "../lib/format";
import type { Question, QuizResult, QuizRules, SkillLevel, SkillRow } from "../lib/types";
import { Badge, Card, Stat, cx } from "./ui";

/** Scores can be fractional with negative marking: show at most 2 decimals. */
export const fmtScore = (n: number) => String(Math.round(n * 100) / 100);

const pointsOff = (points: number, negativePercent: number) => fmtScore((points * negativePercent) / 100);

/** One line explaining how the quiz is marked. */
export function RulesNote({ rules, className }: { rules: QuizRules; className?: string }) {
  const parts = [
    rules.negativePercent > 0
      ? `A wrong answer loses ${rules.negativePercent}% of that question's points; skipping costs nothing, so don't guess.`
      : "No negative marking: a wrong answer just scores 0.",
    rules.passPercent != null ? `Pass mark ${rules.passPercent}%.` : null,
    rules.mode === "PRACTICE" ? "Practice: take it as often as you like; it doesn't count towards the leaderboard." : null,
  ].filter(Boolean);
  // A block <span>, so it can sit inside a paragraph (like a page subtitle).
  return <span className={cx("block text-sm text-muted", className)}>{parts.join(" ")}</span>;
}

/** The questions with their options. Answers can be cleared, to skip a question on purpose. */
export function QuestionList({
  questions,
  answers,
  onChange,
  disabled,
  negativePercent,
}: {
  questions: Question[];
  answers: Record<string, string>;
  onChange: (answers: Record<string, string>) => void;
  disabled?: boolean;
  negativePercent: number;
}) {
  return (
    <ol className="space-y-3">
      {questions.map((q, i) => (
        <li key={q.id}>
          <Card>
            <fieldset>
              <legend className="mb-3 flex w-full justify-between gap-3 font-medium">
                <span>
                  {i + 1}. {q.text}
                </span>
                <span className="flex shrink-0 items-center gap-2 text-xs font-normal text-muted">
                  {q.skill && <Badge tone="brand">{q.skill}</Badge>}
                  {q.points} pt{q.points === 1 ? "" : "s"}
                  {negativePercent > 0 && <span className="text-bad">−{pointsOff(q.points, negativePercent)} if wrong</span>}
                </span>
              </legend>
              <div className="space-y-2">
                {q.options.map((o) => (
                  <label
                    key={o.id}
                    className={cx(
                      "flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm",
                      answers[q.id] === o.id ? "border-brand bg-brand-soft" : "border-line hover:bg-canvas",
                    )}
                  >
                    <input type="radio" name={q.id} checked={answers[q.id] === o.id} onChange={() => onChange({ ...answers, [q.id]: o.id })} className="size-4 accent-brand" disabled={disabled} />
                    {o.text}
                  </label>
                ))}
              </div>
              {answers[q.id] && !disabled && (
                <button
                  type="button"
                  className="mt-2 text-xs font-medium text-muted hover:text-ink"
                  onClick={() => {
                    const { [q.id]: _, ...rest } = answers;
                    onChange(rest);
                  }}
                >
                  Clear answer (skip this question)
                </button>
              )}
            </fieldset>
          </Card>
        </li>
      ))}
    </ol>
  );
}

/** Score, pass/fail and the right/wrong/skipped counts. */
export function ResultStats({ r }: { r: QuizResult }) {
  return (
    <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Stat
        label="Score"
        value={`${fmtScore(r.score)}/${r.maxScore}`}
        hint={fmtPct(r.percentage)}
        tone={r.status === "EXPIRED" || r.passed === false ? "bad" : r.passed ? "good" : undefined}
      />
      <Stat
        label="Result"
        value={r.passed == null ? "—" : r.passed ? "Passed" : "Not passed"}
        hint={r.passPercent != null ? `Pass mark ${r.passPercent}%` : "No pass mark set"}
        tone={r.passed == null ? undefined : r.passed ? "good" : "bad"}
      />
      <Stat label="Right · wrong · skipped" value={`${r.correct} · ${r.wrong} · ${r.skipped}`} hint={r.negativePercent > 0 ? `Wrong answers cost ${r.negativePercent}% of their points` : "No negative marking"} />
      <Stat label="Time taken" value={fmtDuration(r.timeTakenMs)} />
    </div>
  );
}

/** Each question with the student's answer, the right one and why. */
export function AnswerReview({ review, negativePercent }: { review: QuizResult["review"]; negativePercent: number }) {
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold">Answer review</h2>
      {review.map((q, i) => {
        const skipped = !q.yourOptionId;
        const earned = q.correct ? `+${q.points}` : skipped || negativePercent === 0 ? "0" : `−${pointsOff(q.points, negativePercent)}`;
        return (
          <Card
            key={q.questionId}
            title={
              <span className="flex items-start gap-2">
                {q.correct ? <Check className="mt-0.5 size-4 shrink-0 text-good" aria-label="Correct" /> : <X className="mt-0.5 size-4 shrink-0 text-bad" aria-label={skipped ? "Skipped" : "Wrong"} />}
                {i + 1}. {q.text}
              </span>
            }
            actions={
              <span className="flex items-center gap-2 text-xs text-muted">
                {q.skill && (
                  <span className="flex items-center gap-1">
                    <Tag className="size-3" /> {q.skill}
                  </span>
                )}
                {earned} / {q.points}
              </span>
            }
          >
            <ul className="space-y-1.5">
              {q.options.map((o) => {
                const mine = o.id === q.yourOptionId;
                return (
                  <li
                    key={o.id}
                    className={cx(
                      "flex items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-sm",
                      o.isCorrect ? "border-good/40 bg-good-soft" : mine ? "border-bad/40 bg-bad-soft" : "border-transparent text-muted",
                    )}
                  >
                    {o.text}
                    <span className="flex gap-1">
                      {mine && <Badge tone={o.isCorrect ? "good" : "bad"}>Your answer</Badge>}
                      {o.isCorrect && <Badge tone="good">Correct</Badge>}
                    </span>
                  </li>
                );
              })}
              {skipped && <li className="text-xs text-muted">You skipped this one.</li>}
            </ul>
            {q.explanation && (
              <p className="mt-3 flex gap-2 rounded-md bg-canvas px-3 py-2 text-sm text-ink">
                <Lightbulb className="mt-0.5 size-4 shrink-0 text-warn" />
                <span>{q.explanation}</span>
              </p>
            )}
          </Card>
        );
      })}
    </div>
  );
}

const levelStyle: Record<SkillLevel, { bar: string; label: string; tone: "good" | "warn" | "bad" }> = {
  STRONG: { bar: "bg-good", label: "Strength", tone: "good" },
  OK: { bar: "bg-warn", label: "Getting there", tone: "warn" },
  GAP: { bar: "bg-bad", label: "Skill gap", tone: "bad" },
};

/** Accuracy per skill as bars, weakest first. */
export function SkillBars({ skills, empty = "No test answers yet." }: { skills: SkillRow[]; empty?: string }) {
  if (skills.length === 0) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ul className="space-y-3">
      {skills.map((s) => {
        const style = levelStyle[s.level];
        return (
          <li key={s.skill}>
            <div className="mb-1 flex items-center justify-between gap-2 text-sm">
              <span className="font-medium">{s.skill}</span>
              <span className="flex items-center gap-2 text-xs text-muted">
                {s.correct}/{s.questions} right
                <Badge tone={style.tone}>{style.label}</Badge>
                <span className="w-12 text-right font-semibold tabular-nums text-ink">{fmtPct(s.accuracy)}</span>
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-canvas" role="img" aria-label={`${s.skill}: ${s.accuracy}% correct`}>
              <div className={cx("h-full rounded-full transition-[width] duration-700", style.bar)} style={{ width: `${Math.max(2, s.accuracy)}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
