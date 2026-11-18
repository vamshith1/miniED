import { prisma } from "../../lib/prisma.js";
import { fromDbDate } from "../../lib/dates.js";
import type { AuthUser } from "../../middleware/auth.js";
import { rank } from "../quizzes/leaderboard.js";

/**
 * A student's own detailed progress, behind the averages on their home page:
 * every quiz attempt, every attendance day, and how much time went into learning.
 * Only ever reads the signed-in student's data.
 */

const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : null);

// ---------- Quizzes

export async function quizHistory(user: AuthUser) {
  const attempts = await prisma.quizAttempt.findMany({
    where: { studentId: user.id, status: { in: ["SUBMITTED", "EXPIRED"] } },
    orderBy: { startedAt: "asc" },
    select: {
      id: true,
      status: true,
      score: true,
      maxScore: true,
      timeTakenMs: true,
      startedAt: true,
      submittedAt: true,
      quiz: { select: { id: true, title: true, durationSeconds: true, batch: { select: { name: true } } } },
    },
  });

  // Everyone's submitted results for those quizzes, to place this student among their classmates.
  const others = await prisma.quizAttempt.findMany({
    where: { quizId: { in: attempts.map((a) => a.quiz.id) }, status: "SUBMITTED" },
    orderBy: [{ score: "desc" }, { timeTakenMs: "asc" }],
    select: { quizId: true, studentId: true, score: true, maxScore: true, timeTakenMs: true },
  });
  const byQuiz = new Map<string, typeof others>();
  for (const o of others) byQuiz.set(o.quizId, [...(byQuiz.get(o.quizId) ?? []), o]);

  const items = attempts.map((a) => {
    const field = byQuiz.get(a.quiz.id) ?? [];
    const ranked = rank(field, (x, y) => x.score === y.score && x.timeTakenMs === y.timeTakenMs);
    const mine = ranked.find((r) => r.studentId === user.id);
    const classPct = field.length ? pct(field.reduce((s, f) => s + f.score, 0), field.reduce((s, f) => s + f.maxScore, 0)) : null;
    return {
      attemptId: a.id,
      quizId: a.quiz.id,
      title: a.quiz.title,
      batchName: a.quiz.batch.name,
      status: a.status,
      takenAt: (a.submittedAt ?? a.startedAt).toISOString(),
      score: a.score,
      maxScore: a.maxScore,
      percentage: pct(a.score, a.maxScore) ?? 0,
      // An expired attempt used the whole time limit.
      timeTakenMs: a.timeTakenMs ?? a.quiz.durationSeconds * 1000,
      durationSeconds: a.quiz.durationSeconds,
      rank: mine?.rank ?? null, // null for an expired attempt: it isn't on the leaderboard
      outOf: field.length,
      classAverage: classPct,
    };
  });

  const scored = items.filter((i) => i.status === "SUBMITTED");
  const totals = items.reduce((t, i) => ({ score: t.score + i.score, max: t.max + i.maxScore }), { score: 0, max: 0 });
  return {
    summary: {
      taken: items.length,
      averagePercentage: pct(totals.score, totals.max),
      bestPercentage: scored.length ? Math.max(...scored.map((i) => i.percentage)) : null,
      latestPercentage: items.at(-1)?.percentage ?? null,
      firstPlaces: items.filter((i) => i.rank === 1).length,
      totalTimeMs: items.reduce((s, i) => s + i.timeTakenMs, 0),
    },
    items: items.reverse(), // newest first for the table; the chart re-sorts
  };
}

// ---------- Attendance

type Mark = "PRESENT" | "LATE" | "ABSENT";
const attended = (s: Mark) => s !== "ABSENT"; // LATE counts as attended, as everywhere else

function streaks(statuses: Mark[]) {
  let longest = 0;
  let run = 0;
  for (const s of statuses) {
    run = attended(s) ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  return { current: run, longest };
}

export async function attendanceHistory(user: AuthUser) {
  const [records, me] = await Promise.all([
    prisma.attendance.findMany({
      where: { studentId: user.id },
      orderBy: { date: "asc" },
      select: { date: true, status: true, batch: { select: { name: true } } },
    }),
    prisma.user.findUnique({
      where: { id: user.id },
      select: { batch: { select: { name: true, course: true, startDate: true, endDate: true, classMinutes: true } } },
    }),
  ]);
  const count = (s: Mark) => records.filter((r) => r.status === s).length;
  const present = count("PRESENT");
  const late = count("LATE");
  const s = streaks(records.map((r) => r.status));
  return {
    batch: me?.batch
      ? { ...me.batch, startDate: fromDbDate(me.batch.startDate), endDate: me.batch.endDate ? fromDbDate(me.batch.endDate) : null }
      : null,
    summary: {
      marked: records.length,
      present,
      late,
      absent: count("ABSENT"),
      percentage: pct(present + late, records.length),
      currentStreak: s.current, // attended days in a row, up to the latest marked day
      longestStreak: s.longest,
    },
    // Oldest first; the page groups them by month.
    records: records.map((r) => ({ date: fromDbDate(r.date), status: r.status, batchName: r.batch.name })),
  };
}

// ---------- Time spent

const WEEKS = 12;

// A moment's calendar day on the server's clock (TZ), as a UTC-midnight date like date-only columns.
const localDay = (d: Date) => new Date(`${d.toLocaleDateString("en-CA")}T00:00:00Z`);

// Monday of the week containing `d`, as YYYY-MM-DD (UTC, matching date-only columns).
function weekOf(d: Date) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x.toISOString().slice(0, 10);
}

/**
 * Learning time = class time + quiz time.
 *   Class time: each attended day (present or late) counts as one class of the batch's
 *   "class length". If the batch has no class length set, class time is unknown (null)
 *   and only the days are reported. Nothing is guessed.
 *   Quiz time: the measured time of every finished attempt.
 */
export async function timeSpent(user: AuthUser) {
  const [records, attempts] = await Promise.all([
    prisma.attendance.findMany({
      where: { studentId: user.id, status: { in: ["PRESENT", "LATE"] } },
      select: { date: true, batch: { select: { classMinutes: true } } },
    }),
    prisma.quizAttempt.findMany({
      where: { studentId: user.id, status: { in: ["SUBMITTED", "EXPIRED"] } },
      select: { timeTakenMs: true, startedAt: true, submittedAt: true, quiz: { select: { durationSeconds: true } } },
    }),
  ]);

  const classLengthKnown = records.length === 0 || records.every((r) => r.batch.classMinutes);
  const classMinutes = records.reduce((s, r) => s + (r.batch.classMinutes ?? 0), 0);
  const quizMs = (a: (typeof attempts)[number]) => a.timeTakenMs ?? a.quiz.durationSeconds * 1000;
  const quizMinutes = attempts.reduce((s, a) => s + quizMs(a), 0) / 60_000;

  // The last 12 weeks, oldest first, including empty weeks.
  const thisWeek = weekOf(localDay(new Date()));
  const weeks = Array.from({ length: WEEKS }, (_, i) => {
    const d = new Date(`${thisWeek}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - (WEEKS - 1 - i) * 7);
    return { weekStart: d.toISOString().slice(0, 10), classMinutes: 0, quizMinutes: 0, daysAttended: 0, quizzes: 0 };
  });
  const week = new Map(weeks.map((w) => [w.weekStart, w]));
  for (const r of records) {
    const w = week.get(weekOf(r.date));
    if (w) {
      w.daysAttended++;
      w.classMinutes += r.batch.classMinutes ?? 0;
    }
  }
  for (const a of attempts) {
    const w = week.get(weekOf(localDay(a.submittedAt ?? a.startedAt)));
    if (w) {
      w.quizzes++;
      w.quizMinutes += quizMs(a) / 60_000;
    }
  }
  const round = (n: number) => Math.round(n * 10) / 10;
  const activeWeeks = weeks.filter((w) => w.daysAttended || w.quizzes).length;
  const totalMinutes = classMinutes + quizMinutes;
  return {
    classLengthKnown,
    totals: {
      totalMinutes: round(totalMinutes),
      classMinutes: classLengthKnown ? round(classMinutes) : null,
      quizMinutes: round(quizMinutes),
      daysAttended: records.length,
      quizzesTaken: attempts.length,
      thisWeekMinutes: round((week.get(thisWeek)?.classMinutes ?? 0) + (week.get(thisWeek)?.quizMinutes ?? 0)),
      averagePerActiveWeekMinutes: activeWeeks ? round(weeks.reduce((s, w) => s + w.classMinutes + w.quizMinutes, 0) / activeWeeks) : 0,
    },
    weeks: weeks.map((w) => ({ ...w, classMinutes: round(w.classMinutes), quizMinutes: round(w.quizMinutes) })),
  };
}
