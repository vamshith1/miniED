import { z } from "zod";

// Date-only values ("2026-11-07") are stored as Postgres DATE columns.
// They're always parsed as UTC midnight so the stored day never shifts
// by a timezone offset.
export const dateOnly = z.iso.date({ error: "Use the format YYYY-MM-DD" });

export const toDbDate = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
export const fromDbDate = (d: Date) => d.toISOString().slice(0, 10);

// Today's date on the server's clock, as YYYY-MM-DD.
export const todayYmd = () => new Date().toLocaleDateString("en-CA");
