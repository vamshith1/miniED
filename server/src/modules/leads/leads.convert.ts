import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../lib/http-error.js";
import { hashPassword } from "../../lib/password.js";
import { publicUserSelect } from "../auth/auth.service.js";

// 12 random characters, e.g. "q7Vx-2Lp_9Ka"
const generatePassword = () => randomBytes(9).toString("base64url");

/**
 * Turns a lead into a student:
 *   1. create a STUDENT account from the lead's name/email/phone
 *   2. put the student in the chosen batch
 *   3. mark the lead ENROLLED, link it to the student, stop reminders
 *   4. write a CONVERTED entry to the lead's timeline
 * All four happen in one transaction, so a failure leaves nothing half done.
 */
export async function convertLead(leadId: string, batchId: string, actorId: string, password?: string) {
  const [lead, batch] = await Promise.all([
    prisma.lead.findUnique({ where: { id: leadId } }),
    prisma.batch.findUnique({ where: { id: batchId }, select: { id: true, name: true } }),
  ]);
  if (!lead) throw new HttpError(404, "Lead not found");
  if (!batch) throw new HttpError(400, "batchId does not match any batch");
  if (lead.stage === "ENROLLED") throw new HttpError(409, "This lead is already enrolled");

  const plainPassword = password ?? generatePassword();
  const passwordHash = await hashPassword(plainPassword);

  try {
    const student = await prisma.$transaction(async (tx) => {
      // Re-check inside the transaction: if two admins click "Enroll" at the
      // same moment, only the first update matches and the second one stops.
      const { count } = await tx.lead.updateMany({
        where: { id: leadId, stage: { not: "ENROLLED" } },
        data: { stage: "ENROLLED", nextFollowUpAt: null },
      });
      if (count === 0) throw new HttpError(409, "This lead is already enrolled");

      const user = await tx.user.create({
        data: {
          name: lead.name,
          email: lead.email,
          phone: lead.phone,
          role: "STUDENT",
          passwordHash,
          batchId,
        },
        select: publicUserSelect,
      });

      await tx.lead.update({ where: { id: leadId }, data: { convertedUserId: user.id } });
      await tx.leadActivity.create({
        data: {
          leadId,
          actorId,
          type: "CONVERTED",
          meta: { from: lead.stage, studentId: user.id, batchId, batchName: batch.name },
        },
      });
      return user;
    });

    return {
      student,
      batch,
      // Only returned when generated, and only this once. It isn't stored anywhere.
      ...(password ? {} : { temporaryPassword: plainPassword }),
    };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new HttpError(409, "A user account with this lead's email already exists");
    }
    throw err;
  }
}
