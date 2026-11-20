// Marking rules shared by tests and practice.
//   Right answer: + the question's points.
//   Wrong answer: − negativePercent% of the question's points.
//   Skipped:      0, so guessing never pays.
// The total never goes below 0, and is kept to 2 decimal places.

export type AnswerKey = { id: string; points: number; options: { id: string; isCorrect: boolean }[] };

export const round2 = (n: number) => Math.round(n * 100) / 100;
export const percentOf = (score: number, max: number) => (max ? Math.round((score / max) * 1000) / 10 : 0);

export function grade(questions: AnswerKey[], chosen: Map<string, string | null>, negativePercent: number) {
  let raw = 0;
  let correct = 0;
  let wrong = 0;
  let skipped = 0;
  const rows = questions.map((q) => {
    const optionId = chosen.get(q.id) ?? null;
    const isCorrect = !!optionId && q.options.some((o) => o.id === optionId && o.isCorrect);
    if (!optionId) skipped++;
    else if (isCorrect) {
      correct++;
      raw += q.points;
    } else {
      wrong++;
      raw -= (q.points * negativePercent) / 100;
    }
    return { questionId: q.id, optionId, isCorrect };
  });
  const maxScore = questions.reduce((s, q) => s + q.points, 0);
  return { score: round2(Math.max(0, raw)), maxScore, correct, wrong, skipped, rows };
}

// Null when the quiz has no pass mark.
export const passed = (score: number, maxScore: number, passPercent: number | null) =>
  passPercent == null ? null : percentOf(score, maxScore) >= passPercent;
