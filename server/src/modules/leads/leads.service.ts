import { Prisma, type LeadStage } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../lib/http-error.js";
import { paginated, toSkipTake } from "../../lib/pagination.js";
import type { CreateLeadInput, ListLeadsQuery, UpdateLeadInput } from "./leads.schemas.js";

const userBrief = { select: { id: true, name: true, email: true } } as const;

const leadInclude = {
  assignedTo: userBrief,
  createdBy: userBrief,
  _count: { select: { notes: true } },
} satisfies Prisma.LeadInclude;

export async function getLeadOr404(id: string) {
  const lead = await prisma.lead.findUnique({ where: { id }, include: leadInclude });
  if (!lead) throw new HttpError(404, "Lead not found");
  return lead;
}

// Leads can only be assigned to active admins or mentors.
async function assertAssignable(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, isActive: true } });
  if (!user || !user.isActive || user.role === "STUDENT") {
    throw new HttpError(400, "assignedToId must be an active admin or mentor");
  }
}

// One lead per email, so the same person isn't followed up twice.
async function assertEmailFree(email: string, exceptId?: string) {
  const existing = await prisma.lead.findFirst({
    where: { email, ...(exceptId && { id: { not: exceptId } }) },
    select: { id: true },
  });
  if (existing) throw new HttpError(409, "A lead with this email already exists", { existingLeadId: existing.id });
}

export async function createLead(input: CreateLeadInput, actorId: string) {
  await assertEmailFree(input.email);
  if (input.assignedToId) await assertAssignable(input.assignedToId);

  return prisma.lead.create({
    data: {
      ...input,
      createdById: actorId,
      activities: { create: { type: "CREATED", actorId } },
    },
    include: leadInclude,
  });
}

export async function listLeads(q: ListLeadsQuery) {
  const where: Prisma.LeadWhereInput = {
    ...(q.stage && { stage: q.stage }),
    ...(q.source && { source: { equals: q.source, mode: "insensitive" } }),
    ...(q.assignedToId && { assignedToId: q.assignedToId }),
    ...(q.followUpDue && {
      nextFollowUpAt: { lte: endOfToday() },
      AND: [{ stage: { notIn: ["ENROLLED", "LOST"] } }], // AND so it combines with ?stage=
    }),
    ...(q.search && {
      OR: [
        { name: { contains: q.search, mode: "insensitive" } },
        { email: { contains: q.search, mode: "insensitive" } },
        { phone: { contains: q.search } },
      ],
    }),
  };

  const orderBy: Record<ListLeadsQuery["sort"], Prisma.LeadOrderByWithRelationInput> = {
    newest: { createdAt: "desc" },
    oldest: { createdAt: "asc" },
    name: { name: "asc" },
    followUp: { nextFollowUpAt: { sort: "asc", nulls: "last" } },
  };

  const [items, total] = await prisma.$transaction([
    prisma.lead.findMany({ where, include: leadInclude, orderBy: orderBy[q.sort], ...toSkipTake(q) }),
    prisma.lead.count({ where }),
  ]);
  return paginated(items, total, q);
}

export async function updateLead(id: string, input: UpdateLeadInput, actorId: string) {
  const lead = await getLeadOr404(id);
  if (input.email && input.email !== lead.email) await assertEmailFree(input.email, id);

  const reassigned = input.assignedToId !== undefined && input.assignedToId !== lead.assignedToId;
  if (reassigned && input.assignedToId) await assertAssignable(input.assignedToId);

  return prisma.lead.update({
    where: { id },
    data: {
      ...input,
      ...(reassigned && {
        activities: {
          create: { type: "ASSIGNED", actorId, meta: { from: lead.assignedToId, to: input.assignedToId ?? null } },
        },
      }),
    },
    include: leadInclude,
  });
}

export async function changeStage(id: string, stage: LeadStage, actorId: string, note?: string) {
  const lead = await getLeadOr404(id);

  if (lead.stage === "ENROLLED") {
    throw new HttpError(409, "This lead is already enrolled as a student; its stage is locked");
  }
  if (stage === "ENROLLED") {
    // Enrolling creates a student account, so it gets its own endpoint (Phase 4).
    throw new HttpError(400, "Use POST /api/leads/:id/convert to enroll a lead");
  }
  if (stage === lead.stage) throw new HttpError(400, `Lead is already in stage ${stage}`);

  return prisma.lead.update({
    where: { id },
    data: {
      stage,
      // Lost leads shouldn't keep getting follow-up reminders.
      ...(stage === "LOST" && { nextFollowUpAt: null }),
      activities: { create: { type: "STAGE_CHANGED", actorId, meta: { from: lead.stage, to: stage, note } } },
      ...(note && { notes: { create: { body: note, authorId: actorId } } }),
    },
    include: leadInclude,
  });
}

export async function addNote(leadId: string, body: string, authorId: string) {
  await getLeadOr404(leadId);
  return prisma.$transaction(async (tx) => {
    const note = await tx.leadNote.create({
      data: { leadId, body, authorId },
      include: { author: userBrief },
    });
    await tx.leadActivity.create({
      data: { leadId, type: "NOTE_ADDED", actorId: authorId, meta: { noteId: note.id, preview: body.slice(0, 120) } },
    });
    return note;
  });
}

export async function listNotes(leadId: string, page: { page: number; limit: number }) {
  await getLeadOr404(leadId);
  const where = { leadId };
  const [items, total] = await prisma.$transaction([
    prisma.leadNote.findMany({ where, include: { author: userBrief }, orderBy: { createdAt: "desc" }, ...toSkipTake(page) }),
    prisma.leadNote.count({ where }),
  ]);
  return paginated(items, total, page);
}

export async function getTimeline(leadId: string, page: { page: number; limit: number }) {
  await getLeadOr404(leadId);
  const where = { leadId };
  const [items, total] = await prisma.$transaction([
    prisma.leadActivity.findMany({
      where,
      include: { actor: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
      ...toSkipTake(page),
    }),
    prisma.leadActivity.count({ where }),
  ]);
  return paginated(items, total, page);
}

export async function deleteLead(id: string) {
  const lead = await getLeadOr404(id);
  if (lead.convertedUserId) throw new HttpError(409, "Enrolled leads can't be deleted; they're linked to a student");
  await prisma.lead.delete({ where: { id } }); // notes and activities cascade
}

function endOfToday() {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}
