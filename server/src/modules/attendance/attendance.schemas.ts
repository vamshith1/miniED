import { z } from "zod";
import { dateOnly } from "../../lib/dates.js";

export const ATTENDANCE_STATUSES = ["PRESENT", "ABSENT", "LATE"] as const;

// One request marks a whole day for the batch.
export const markAttendanceSchema = z.object({
  date: dateOnly,
  records: z
    .array(z.object({ studentId: z.string().min(1), status: z.enum(ATTENDANCE_STATUSES) }))
    .min(1)
    .max(500)
    .refine((r) => new Set(r.map((x) => x.studentId)).size === r.length, "Each student can appear only once"),
});

export const dayQuery = z.object({ date: dateOnly });

export type MarkAttendanceInput = z.infer<typeof markAttendanceSchema>;
