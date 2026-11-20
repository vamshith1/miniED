import { prisma } from "../../lib/prisma.js";

/**
 * Skill-gap report: how a student does on each skill their tests have covered.
 * Built from submitted test answers (practice isn't stored per question).
 * Questions without a skill are grouped under "General".
 */

export type SkillLevel = "STRONG" | "OK" | "GAP";

export type SkillRow = {
  skill: string;
  questions: number;
  correct: number;
  wrong: number;
  skipped: number;
  accuracy: number; // % of questions answered correctly
  level: SkillLevel;
};

// Accuracy below 50% is a gap to work on; 75% and above is a strength.
export const levelOf = (accuracy: number): SkillLevel => (accuracy >= 75 ? "STRONG" : accuracy >= 50 ? "OK" : "GAP");

const GENERAL = "General";

/** Skill rows for each of the given students, weakest skill first. */
export async function skillsFor(studentIds: string[]) {
  const answers = await prisma.attemptAnswer.findMany({
    where: { attempt: { studentId: { in: studentIds }, status: "SUBMITTED" } },
    select: { isCorrect: true, optionId: true, attempt: { select: { studentId: true } }, question: { select: { skill: true } } },
  });

  const tally = new Map<string, Map<string, { questions: number; correct: number; wrong: number; skipped: number }>>();
  for (const a of answers) {
    const sid = a.attempt.studentId;
    const skill = a.question.skill?.trim() || GENERAL;
    const bySkill = tally.get(sid) ?? new Map();
    tally.set(sid, bySkill);
    const t = bySkill.get(skill) ?? { questions: 0, correct: 0, wrong: 0, skipped: 0 };
    bySkill.set(skill, t);
    t.questions++;
    if (!a.optionId) t.skipped++;
    else if (a.isCorrect) t.correct++;
    else t.wrong++;
  }

  const result = new Map<string, SkillRow[]>();
  for (const id of studentIds) {
    const rows = [...(tally.get(id) ?? new Map()).entries()].map(([skill, t]) => {
      const accuracy = Math.round((t.correct / t.questions) * 1000) / 10;
      return { skill, ...t, accuracy, level: levelOf(accuracy) };
    });
    rows.sort((a, b) => a.accuracy - b.accuracy || b.questions - a.questions);
    result.set(id, rows);
  }
  return result;
}

export async function mySkills(studentId: string) {
  const skills = (await skillsFor([studentId])).get(studentId) ?? [];
  return {
    skills,
    gaps: skills.filter((s) => s.level === "GAP").map((s) => s.skill),
    strengths: skills.filter((s) => s.level === "STRONG").map((s) => s.skill),
  };
}
