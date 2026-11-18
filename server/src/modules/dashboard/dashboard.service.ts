import type { LeadStage } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { cacheKeys, getOrSet } from "../../lib/cache.js";
import { endOfToday, toDbDate, todayYmd } from "../../lib/dates.js";

// Short TTL: lead and attendance changes don't clear this key, so the
// numbers can be up to a minute old. Quiz submits clear it straight away.
const TTL_SECONDS = 60;
const WEEKS = 8;
const STAGES: LeadStage[] = ["NEW", "CONTACTED", "INTERESTED", "ENROLLED", "LOST"];

const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : null);
const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 3600 * 1000);

// Monday of the week `weeksBack` weeks ago, at local midnight.
function weekStart(weeksBack: number) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - weeksBack * 7);
  return d;
}

async function leadStats() {
  const since = weekStart(WEEKS - 1);
  const [byStage, bySource, followUpsDue, created, converted] = await Promise.all([
    prisma.lead.groupBy({ by: ["stage"], _count: { _all: true } }),
    prisma.lead.groupBy({ by: ["source"], _count: { _all: true } }),
    prisma.lead.count({ where: { nextFollowUpAt: { lte: endOfToday() }, stage: { notIn: ["ENROLLED", "LOST"] } } }),
    prisma.lead.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true } }),
    prisma.leadActivity.findMany({ where: { type: "CONVERTED", createdAt: { gte: since } }, select: { createdAt: true } }),
  ]);

  const stageCounts = Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<LeadStage, number>;
  byStage.forEach((g) => (stageCounts[g.stage] = g._count._all));
  const total = Object.values(stageCounts).reduce((a, b) => a + b, 0);

  // Top 5 sources, the rest grouped as "Other". Leads without a source show as "Unknown".
  // Sorted here, not in SQL: COUNT(source) would rank leads without a source as 0.
  const sources = bySource
    .map((g) => ({ source: g.source ?? "Unknown", count: g._count._all }))
    .sort((a, b) => b.count - a.count);
  const topSources = sources.slice(0, 5);
  const rest = sources.slice(5).reduce((a, s) => a + s.count, 0);
  if (rest) topSources.push({ source: "Other", count: rest });

  // New and converted leads per week, oldest week first. Weeks start on Monday.
  const weeks = Array.from({ length: WEEKS }, (_, i) => weekStart(WEEKS - 1 - i));
  const weekIndex = (d: Date) => {
    let i = WEEKS - 1;
    while (i > 0 && d < weeks[i]) i--;
    return i;
  };
  const perWeek = weeks.map((w) => ({ weekStart: w.toLocaleDateString("en-CA"), created: 0, converted: 0 }));
  created.forEach((l) => perWeek[weekIndex(l.createdAt)].created++);
  converted.forEach((a) => perWeek[weekIndex(a.createdAt)].converted++);

  return {
    total,
    byStage: stageCounts,
    bySource: topSources,
    followUpsDue,
    // Of the leads that reached an outcome, how many enrolled.
    conversionRate: pct(stageCounts.ENROLLED, stageCounts.ENROLLED + stageCounts.LOST),
    perWeek,
  };
}

async function peopleAndBatches() {
  const today = toDbDate(todayYmd());
  const [students, mentors, batches, activeBatches] = await Promise.all([
    prisma.user.count({ where: { role: "STUDENT", isActive: true } }),
    prisma.user.count({ where: { role: "MENTOR", isActive: true } }),
    prisma.batch.count(),
    prisma.batch.count({ where: { startDate: { lte: today }, OR: [{ endDate: null }, { endDate: { gte: today } }] } }),
  ]);
  return { students, mentors, batches: { total: batches, active: activeBatches } };
}

// Last 30 days: overall %, plus each batch's % (LATE counts as attended, like everywhere else).
async function attendanceStats() {
  const since = toDbDate(daysAgo(30).toLocaleDateString("en-CA"));
  const [groups, batches] = await Promise.all([
    prisma.attendance.groupBy({ by: ["batchId", "status"], where: { date: { gte: since } }, _count: { _all: true } }),
    prisma.batch.findMany({ select: { id: true, name: true } }),
  ]);
  const per = new Map<string, { attended: number; marked: number }>();
  for (const g of groups) {
    const e = per.get(g.batchId) ?? { attended: 0, marked: 0 };
    e.marked += g._count._all;
    if (g.status !== "ABSENT") e.attended += g._count._all;
    per.set(g.batchId, e);
  }
  const all = [...per.values()].reduce((a, e) => ({ attended: a.attended + e.attended, marked: a.marked + e.marked }), { attended: 0, marked: 0 });
  return {
    last30Days: { percentage: pct(all.attended, all.marked), recordsMarked: all.marked },
    byBatch: batches
      .filter((b) => per.has(b.id))
      .map((b) => ({ batchId: b.id, name: b.name, percentage: pct(per.get(b.id)!.attended, per.get(b.id)!.marked) }))
      .sort((a, b) => (a.percentage ?? 0) - (b.percentage ?? 0)), // lowest first: those need attention
  };
}

async function quizStats() {
  const since = daysAgo(30);
  const [published, attempts, perQuiz, quizzes, batches] = await Promise.all([
    prisma.quiz.count({ where: { isPublished: true } }),
    prisma.quizAttempt.aggregate({
      where: { status: "SUBMITTED", submittedAt: { gte: since } },
      _count: { _all: true },
      _sum: { score: true, maxScore: true },
    }),
    // All submitted attempts, per quiz, then summed per batch below (an attempt doesn't store its batch).
    // Expired attempts count as 0, like on the leaderboard.
    prisma.quizAttempt.groupBy({
      by: ["quizId"],
      where: { status: { in: ["SUBMITTED", "EXPIRED"] } },
      _count: { _all: true },
      _sum: { score: true, maxScore: true },
    }),
    prisma.quiz.findMany({ select: { id: true, batchId: true } }),
    prisma.batch.findMany({ select: { id: true, name: true } }),
  ]);

  const batchOfQuiz = new Map(quizzes.map((q) => [q.id, q.batchId]));
  const per = new Map<string, { score: number; max: number; attempts: number }>();
  for (const g of perQuiz) {
    const batchId = batchOfQuiz.get(g.quizId);
    if (!batchId) continue;
    const e = per.get(batchId) ?? { score: 0, max: 0, attempts: 0 };
    e.score += g._sum.score ?? 0;
    e.max += g._sum.maxScore ?? 0;
    e.attempts += g._count._all;
    per.set(batchId, e);
  }

  return {
    published,
    attemptsLast30Days: attempts._count._all,
    averageScoreLast30Days: pct(attempts._sum.score ?? 0, attempts._sum.maxScore ?? 0),
    // Average quiz score per batch (all quizzes so far), highest first. Batches with no attempts are left out.
    byBatch: batches
      .filter((b) => per.has(b.id))
      .map((b) => {
        const e = per.get(b.id)!;
        return { batchId: b.id, name: b.name, averageScore: pct(e.score, e.max), attempts: e.attempts };
      })
      .sort((a, b) => (b.averageScore ?? -1) - (a.averageScore ?? -1)),
  };
}

async function paymentStats() {
  const groups = await prisma.payment.groupBy({
    by: ["status"],
    where: { createdAt: { gte: daysAgo(30) } },
    _count: { _all: true },
    _sum: { amountPaise: true },
  });
  const of = (s: "PAID" | "FAILED" | "CREATED") => groups.find((g) => g.status === s);
  return {
    last30Days: {
      collectedPaise: of("PAID")?._sum.amountPaise ?? 0,
      paid: of("PAID")?._count._all ?? 0,
      failed: of("FAILED")?._count._all ?? 0,
      pending: of("CREATED")?._count._all ?? 0,
    },
  };
}

async function emailStats() {
  const groups = await prisma.emailLog.groupBy({ by: ["status"], where: { createdAt: { gte: daysAgo(7) } }, _count: { _all: true } });
  const get = (s: string) => groups.find((g) => g.status === s)?._count._all ?? 0;
  return { last7Days: { sent: get("SENT"), queued: get("QUEUED"), failed: get("FAILED") } };
}

export function getDashboardStats() {
  return getOrSet(cacheKeys.dashboardStats(), TTL_SECONDS, async () => {
    const [leads, people, attendance, quizzes, emails, payments] = await Promise.all([
      leadStats(),
      peopleAndBatches(),
      attendanceStats(),
      quizStats(),
      emailStats(),
      paymentStats(),
    ]);
    return { generatedAt: new Date().toISOString(), leads, ...people, attendance, quizzes, emails, payments };
  });
}
