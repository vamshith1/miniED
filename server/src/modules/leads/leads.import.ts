import multer from "multer";
import { parse } from "csv-parse/sync";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../lib/http-error.js";
import { leadFields } from "./leads.schemas.js";

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const MAX_ROWS = 5000;
const MAX_ERRORS_RETURNED = 100;

// The file is kept in memory, never written to disk. Fine at 2 MB.
export const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    const looksLikeCsv =
      file.originalname.toLowerCase().endsWith(".csv") &&
      ["text/csv", "application/vnd.ms-excel", "text/plain", "application/octet-stream"].includes(file.mimetype);
    if (looksLikeCsv) cb(null, true);
    else cb(new HttpError(400, "Only .csv files are accepted"));
  },
}).single("file");

// Accept common header spellings: "E-mail", "Course Interest", "follow_up"...
const HEADER_ALIASES: Record<string, keyof typeof leadFields> = {
  name: "name",
  fullname: "name",
  email: "email",
  emailaddress: "email",
  phone: "phone",
  mobile: "phone",
  phonenumber: "phone",
  source: "source",
  course: "courseInterest",
  courseinterest: "courseInterest",
  followup: "nextFollowUpAt",
  nextfollowup: "nextFollowUpAt",
  nextfollowupat: "nextFollowUpAt",
};

const normalizeHeader = (h: string) => HEADER_ALIASES[h.toLowerCase().replace(/[^a-z]/g, "")] ?? null;

const rowSchema = z.object(leadFields);

type RowError = { row: number; email?: string; reason: string };

export async function importLeadsCsv(file: Express.Multer.File | undefined, actorId: string) {
  if (!file) throw new HttpError(400, 'Attach a CSV file in the "file" form field');

  let records: Record<string, string>[];
  try {
    records = parse(file.buffer, {
      bom: true, // Excel adds a byte-order mark
      trim: true,
      skip_empty_lines: true,
      // Unknown columns map to null and are dropped
      columns: (headers: string[]) => headers.map((h) => normalizeHeader(h)),
    });
  } catch (err) {
    throw new HttpError(400, `Could not read CSV: ${(err as Error).message}`);
  }

  if (records.length === 0) throw new HttpError(400, "The CSV has no data rows");
  if (records.length > MAX_ROWS) throw new HttpError(400, `Too many rows (max ${MAX_ROWS})`);
  if (!("name" in records[0]) || !("email" in records[0])) {
    throw new HttpError(400, "The CSV needs at least a 'name' and an 'email' column");
  }

  // 1. Validate each row. Row numbers match what the user sees in Excel
  //    (row 1 is the header).
  const errors: RowError[] = [];
  const valid: (z.infer<typeof rowSchema> & { row: number })[] = [];
  const seenInFile = new Set<string>();

  records.forEach((raw, i) => {
    const row = i + 2;
    const parsed = rowSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      errors.push({ row, email: raw.email, reason: `${issue.path.join(".") || "row"}: ${issue.message}` });
      return;
    }
    if (seenInFile.has(parsed.data.email)) {
      errors.push({ row, email: parsed.data.email, reason: "Duplicate email earlier in this file" });
      return;
    }
    seenInFile.add(parsed.data.email);
    valid.push({ ...parsed.data, row });
  });

  // 2. Skip emails that already exist as leads (one query for the whole file).
  const existing = await prisma.lead.findMany({
    where: { email: { in: valid.map((v) => v.email) } },
    select: { email: true },
  });
  const existingEmails = new Set(existing.map((e) => e.email));
  const toCreate = valid.filter((v) => {
    if (!existingEmails.has(v.email)) return true;
    errors.push({ row: v.row, email: v.email, reason: "A lead with this email already exists" });
    return false;
  });

  // 3. Insert everything in one transaction: all rows land or none do.
  if (toCreate.length > 0) {
    await prisma.$transaction(async (tx) => {
      const created = await tx.lead.createManyAndReturn({
        data: toCreate.map(({ row: _row, ...lead }) => ({
          ...lead,
          source: lead.source ?? "CSV import",
          createdById: actorId,
        })),
        select: { id: true },
      });
      await tx.leadActivity.createMany({
        data: created.map((l) => ({ leadId: l.id, type: "IMPORTED" as const, actorId, meta: { file: file.originalname } })),
      });
    });
  }

  errors.sort((a, b) => a.row - b.row);
  return {
    totalRows: records.length,
    imported: toCreate.length,
    skipped: errors.length,
    errors: errors.slice(0, MAX_ERRORS_RETURNED),
    errorsTruncated: errors.length > MAX_ERRORS_RETURNED,
  };
}
