import { z } from "zod";
import { dateOnly } from "../../lib/dates.js";

const batchFields = {
  name: z.string().trim().min(2).max(60),
  course: z.string().trim().min(2).max(100),
  startDate: dateOnly,
  endDate: dateOnly.optional(),
  mentorId: z.string().optional(),
  // Course fee in paise (₹1 = 100). Up to ₹10,00,000. Leave out for no fee.
  feePaise: z.number().int().min(0).max(100_000_000).optional(),
};

const endAfterStart = (b: { startDate?: string; endDate?: string | null }) =>
  !b.startDate || !b.endDate || b.endDate >= b.startDate;

export const createBatchSchema = z
  .object(batchFields)
  .refine(endAfterStart, { message: "endDate must be on or after startDate", path: ["endDate"] });

export const updateBatchSchema = z
  .object({ ...batchFields, endDate: dateOnly.nullable(), mentorId: z.string().nullable(), feePaise: batchFields.feePaise.unwrap().nullable() })
  .partial()
  .refine((o) => Object.keys(o).length > 0, "Send at least one field to update")
  .refine(endAfterStart, { message: "endDate must be on or after startDate", path: ["endDate"] });

export const addStudentSchema = z.object({ studentId: z.string().min(1) });
