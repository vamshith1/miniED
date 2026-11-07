import { prisma } from "../../lib/prisma.js";
import { endOfToday, startOfToday } from "../../lib/dates.js";
import type { enqueueEmail as EnqueueFn } from "./email.queue.js";

/**
 * Daily reminder: finds open leads whose follow-up date is today or earlier
 * and queues ONE email per person listing their leads.
 *  - Assigned leads go to the assignee.
 *  - Unassigned leads (or ones assigned to a deactivated user) go to every active admin.
 *  - Running it again on the same day skips anyone already reminded today,
 *    unless that email failed, so it's safe to run by hand.
 */
export async function scanFollowUps(enqueue: typeof EnqueueFn) {
  const [leads, admins] = await Promise.all([
    prisma.lead.findMany({
      where: { nextFollowUpAt: { lte: endOfToday() }, stage: { notIn: ["ENROLLED", "LOST"] } },
      select: { id: true, assignedTo: { select: { id: true, email: true, isActive: true } } },
    }),
    prisma.user.findMany({ where: { role: "ADMIN", isActive: true }, select: { id: true, email: true } }),
  ]);

  const byRecipient = new Map<string, { email: string; leadIds: string[] }>();
  const addTo = (user: { id: string; email: string }, leadId: string) => {
    const entry = byRecipient.get(user.id) ?? { email: user.email, leadIds: [] };
    entry.leadIds.push(leadId);
    byRecipient.set(user.id, entry);
  };
  for (const lead of leads) {
    if (lead.assignedTo?.isActive) addTo(lead.assignedTo, lead.id);
    else admins.forEach((a) => addTo(a, lead.id));
  }

  const alreadyReminded = new Set(
    (
      await prisma.emailLog.findMany({
        where: {
          template: "lead-follow-up",
          createdAt: { gte: startOfToday() },
          status: { not: "FAILED" },
          to: { in: [...byRecipient.values()].map((r) => r.email) },
        },
        select: { to: true },
      })
    ).map((e) => e.to),
  );

  const emails = [];
  let skipped = 0;
  for (const [userId, { email, leadIds }] of byRecipient) {
    if (alreadyReminded.has(email)) {
      skipped++;
      continue;
    }
    const queued = await enqueue("lead-follow-up", email, { userId, leadIds });
    emails.push({ ...queued, to: email, leads: leadIds.length });
  }
  return { dueLeads: leads.length, queued: emails.length, skippedAlreadyReminded: skipped, emails };
}
