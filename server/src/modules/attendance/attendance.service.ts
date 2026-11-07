import type { AttendanceStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../lib/http-error.js";
import { fromDbDate, toDbDate, todayYmd } from "../../lib/dates.js";
import type { AuthUser } from "../../middleware/auth.js";
import { assertCanManageBatch, listStudents } from "../batches/batches.service.js";
import type { MarkAttendanceInput } from "./attendance.schemas.js";

type Counts = { present: number; late: number; absent: number; total: number; percentage: number | null };

// LATE counts as attended. percentage is null when nothing has been marked yet.
function toCounts(byStatus: Partial<Record<AttendanceStatus, number>>): Counts {
  const present = byStatus.PRESENT ?? 0;
  const late = byStatus.LATE ?? 0;
  const absent = byStatus.ABSENT ?? 0;
  const total = present + late + absent;
  return { present, late, absent, total, percentage: total ? Math.round(((present + late) / total) * 1000) / 10 : null };
}

export async function markDay(batchId: string, input: MarkAttendanceInput, user: AuthUser) {
  const batch = await assertCanManageBatch(batchId, user);

  if (input.date > todayYmd()) throw new HttpError(400, "Attendance can't be marked for a future date");
  if (input.date < fromDbDate(batch.startDate)) throw new HttpError(400, "That date is before the batch started");
  if (batch.endDate && input.date > fromDbDate(batch.endDate)) throw new HttpError(400, "That date is after the batch ended");

  // Every student in the request must belong to this batch.
  const ids = input.records.map((r) => r.studentId);
  const inBatch = await prisma.user.findMany({
    where: { id: { in: ids }, batchId, role: "STUDENT" },
    select: { id: true },
  });
  const valid = new Set(inBatch.map((s) => s.id));
  const notInBatch = ids.filter((id) => !valid.has(id));
  if (notInBatch.length) throw new HttpError(400, "Some students are not in this batch", { notInBatch });

  // Upsert so marking the same day again corrects it instead of failing.
  const date = toDbDate(input.date);
  await prisma.$transaction(
    input.records.map((r) =>
      prisma.attendance.upsert({
        where: { studentId_date: { studentId: r.studentId, date } },
        create: { batchId, date, studentId: r.studentId, status: r.status, markedById: user.id },
        update: { status: r.status, batchId, markedById: user.id },
      }),
    ),
  );

  return { date: input.date, marked: input.records.length };
}

// The roster for one day, with each student's status (null = not marked yet).
export async function getDay(batchId: string, ymd: string, user: AuthUser) {
  await assertCanManageBatch(batchId, user);
  const [students, records] = await Promise.all([
    listStudents(batchId),
    prisma.attendance.findMany({ where: { batchId, date: toDbDate(ymd) }, select: { studentId: true, status: true } }),
  ]);
  const statusById = new Map(records.map((r) => [r.studentId, r.status]));
  const items = students.map((s) => ({ student: { id: s.id, name: s.name, email: s.email }, status: statusById.get(s.id) ?? null }));
  return { date: ymd, items, unmarked: items.filter((i) => !i.status).length };
}

// Attendance % for every student in the batch, plus the batch average.
export async function batchSummary(batchId: string, user: AuthUser) {
  await assertCanManageBatch(batchId, user);
  const [students, groups] = await Promise.all([
    listStudents(batchId),
    prisma.attendance.groupBy({ by: ["studentId", "status"], where: { batchId }, _count: { _all: true } }),
  ]);

  const byStudent = new Map<string, Partial<Record<AttendanceStatus, number>>>();
  for (const g of groups) {
    const entry = byStudent.get(g.studentId) ?? {};
    entry[g.status] = g._count._all;
    byStudent.set(g.studentId, entry);
  }

  const items = students.map((s) => ({
    student: { id: s.id, name: s.name, email: s.email },
    ...toCounts(byStudent.get(s.id) ?? {}),
  }));
  const withData = items.filter((i) => i.percentage !== null);
  const average = withData.length
    ? Math.round((withData.reduce((sum, i) => sum + i.percentage!, 0) / withData.length) * 10) / 10
    : null;

  return { batchId, averagePercentage: average, items };
}

// A student's own attendance.
export async function mySummary(user: AuthUser) {
  const [groups, recent] = await Promise.all([
    prisma.attendance.groupBy({ by: ["status"], where: { studentId: user.id }, _count: { _all: true } }),
    prisma.attendance.findMany({
      where: { studentId: user.id },
      orderBy: { date: "desc" },
      take: 30,
      select: { date: true, status: true },
    }),
  ]);
  const counts = toCounts(Object.fromEntries(groups.map((g) => [g.status, g._count._all])));
  return {
    batchId: user.batchId,
    ...counts,
    recent: recent.map((r) => ({ date: fromDbDate(r.date), status: r.status })),
  };
}
