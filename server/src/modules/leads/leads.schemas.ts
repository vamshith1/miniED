import { z } from "zod";
import { paginationQuery } from "../../lib/pagination.js";

export const STAGES = ["NEW", "CONTACTED", "INTERESTED", "ENROLLED", "LOST"] as const;

// Empty strings from forms or CSV cells become undefined instead of "".
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

// An empty cell means "no follow-up date", not an invalid date.
const optionalDate = z.preprocess(
  (v) => (v === "" || v === null ? undefined : v),
  z.coerce.date({ error: "Must be a valid date, e.g. 2026-11-10" }).optional(),
);

export const leadFields = {
  name: z.string().trim().min(2).max(100),
  email: z.email().trim().toLowerCase(),
  phone: optionalText(20),
  source: optionalText(50),
  courseInterest: optionalText(100),
  nextFollowUpAt: optionalDate,
};

export const createLeadSchema = z.object({
  ...leadFields,
  assignedToId: z.string().optional(),
});

// Every field is optional on update. Stage has its own endpoint because it
// has rules and writes to the timeline.
export const updateLeadSchema = z
  .object({
    ...leadFields,
    // null clears the follow-up date
    nextFollowUpAt: z.union([z.null(), z.coerce.date({ error: "Must be a valid date, e.g. 2026-11-10" })]),
    assignedToId: z.string().nullable(),
  })
  .partial()
  .refine((o) => Object.keys(o).length > 0, "Send at least one field to update");

export const changeStageSchema = z.object({
  stage: z.enum(STAGES),
  note: z.string().trim().max(2000).optional(), // optional reason, e.g. why it was lost
});

export const addNoteSchema = z.object({
  body: z.string().trim().min(1).max(5000),
});

export const listLeadsQuery = paginationQuery.extend({
  search: z.string().trim().max(100).optional(), // matches name, email or phone
  stage: z.enum(STAGES).optional(),
  source: z.string().trim().optional(),
  assignedToId: z.string().optional(),
  followUpDue: z.stringbool().optional(), // true = follow-up date is today or earlier
  sort: z.enum(["newest", "oldest", "name", "followUp"]).default("newest"),
});

export type CreateLeadInput = z.infer<typeof createLeadSchema>;
export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;
export type ListLeadsQuery = z.infer<typeof listLeadsQuery>;
