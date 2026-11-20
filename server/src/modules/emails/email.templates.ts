import { prisma } from "../../lib/prisma.js";
import { env } from "../../config/env.js";
import { open } from "../../lib/secret-box.js";
import type { Mail } from "../../lib/mailer.js";

/**
 * What each email's job carries. Mostly IDs: the data is loaded when the
 * email is sent, so it's always current. The one exception is the temporary
 * password, which exists nowhere else and is encrypted (see secret-box).
 */
export type EmailPayloads = {
  welcome: { userId: string; sealedPassword?: string };
  "quiz-result": { attemptId: string };
  "lead-follow-up": { userId: string; leadIds: string[] };
  "password-reset": { userId: string; sealedToken: string };
  "password-changed": { userId: string; how: "changed" | "reset" };
  "payment-receipt": { paymentId: string };
  "application-update": { applicationId: string };
  "interview-scheduled": { interviewId: string };
};
export type EmailTemplate = keyof EmailPayloads;
export const TEMPLATES = [
  "welcome",
  "quiz-result",
  "lead-follow-up",
  "password-reset",
  "password-changed",
  "payment-receipt",
  "application-update",
  "interview-scheduled",
] as const satisfies EmailTemplate[];

// Retrying won't help (e.g. the user was deleted), so the queue gives up at once.
export class PermanentEmailError extends Error {}

type Rendered = Omit<Mail, "to">;

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// One simple layout for every email. `body` is already-escaped HTML.
const layout = (title: string, body: string) => `<!doctype html>
<html><body style="margin:0;background:#f4f5f7;font-family:Segoe UI,Arial,sans-serif;color:#1f2933">
<div style="max-width:560px;margin:24px auto;background:#fff;border-radius:8px;padding:28px">
<h1 style="font-size:20px;margin:0 0 16px">${esc(title)}</h1>
${body}
<p style="color:#7b8794;font-size:12px;margin-top:28px">MiniEdCRM</p>
</div></body></html>`;

const button = (href: string, label: string) =>
  `<p><a href="${esc(href)}" style="display:inline-block;background:#7c3aed;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">${esc(label)}</a></p>`;

async function welcome({ userId, sealedPassword }: EmailPayloads["welcome"]): Promise<Rendered> {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { batch: { select: { name: true, course: true } } } });
  if (!user) throw new PermanentEmailError("User no longer exists");
  const password = sealedPassword ? open(sealedPassword) : null;
  const loginUrl = `${env.CLIENT_URL}/login`;

  const lines = [
    `Hi ${user.name},`,
    user.batch
      ? `Welcome to MiniEdCRM! You've been enrolled in ${user.batch.name} (${user.batch.course}).`
      : `Welcome to MiniEdCRM! Your account is ready.`,
    `Sign in at ${loginUrl} with your email: ${user.email}`,
    password
      ? `Your temporary password is: ${password}\nKeep it private.`
      : `Use the password you chose, or the one your admin gave you.`,
  ];
  return {
    subject: "Welcome to MiniEdCRM",
    text: lines.join("\n\n"),
    html: layout(
      "Welcome to MiniEdCRM",
      `<p>Hi ${esc(user.name)},</p><p>${esc(lines[1])}</p>
<p>Sign in with your email: <b>${esc(user.email)}</b></p>
${password ? `<p>Your temporary password is: <code style="font-size:16px;background:#f4f5f7;padding:2px 6px">${esc(password)}</code><br>Keep it private.</p>` : `<p>${esc(lines[3])}</p>`}
${button(loginUrl, "Sign in")}`,
    ),
  };
}

async function quizResult({ attemptId }: EmailPayloads["quiz-result"]): Promise<Rendered> {
  const attempt = await prisma.quizAttempt.findUnique({
    where: { id: attemptId },
    include: { student: { select: { name: true } }, quiz: { select: { id: true, title: true, jobId: true } } },
  });
  if (!attempt || attempt.status !== "SUBMITTED") throw new PermanentEmailError("Attempt not found or not submitted");

  // Same ranking as the leaderboard: higher score first, then faster time.
  const ahead = await prisma.quizAttempt.count({
    where: {
      quizId: attempt.quizId,
      status: "SUBMITTED",
      OR: [{ score: { gt: attempt.score } }, { score: attempt.score, timeTakenMs: { lt: attempt.timeTakenMs ?? 0 } }],
    },
  });
  const total = await prisma.quizAttempt.count({ where: { quizId: attempt.quizId, status: "SUBMITTED" } });
  const pct = attempt.maxScore ? Math.round((attempt.score / attempt.maxScore) * 100) : 0;
  const secs = Math.round((attempt.timeTakenMs ?? 0) / 1000);
  const time = `${Math.floor(secs / 60)}m ${secs % 60}s`;
  const url = `${env.CLIENT_URL}/quizzes/${attempt.quiz.id}/result`;
  // A hiring test doesn't tell applicants where they stand against each other.
  const summary = `You scored ${attempt.score}/${attempt.maxScore} (${pct}%) in ${time}.${attempt.quiz.jobId ? "" : ` You're currently #${ahead + 1} of ${total}.`}`;

  return {
    subject: `Your result: ${attempt.quiz.title}`,
    text: `Hi ${attempt.student.name},\n\n${summary}\n\nSee every answer: ${url}`,
    html: layout(
      attempt.quiz.title,
      `<p>Hi ${esc(attempt.student.name)},</p>
<p style="font-size:28px;margin:8px 0"><b>${attempt.score}/${attempt.maxScore}</b> <span style="color:#7b8794;font-size:18px">${pct}%</span></p>
<p>${esc(summary)}</p>
${button(url, "Review your answers")}`,
    ),
  };
}

async function leadFollowUp({ userId, leadIds }: EmailPayloads["lead-follow-up"]): Promise<Rendered> {
  const [user, leads] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
    prisma.lead.findMany({
      where: { id: { in: leadIds } },
      orderBy: { nextFollowUpAt: "asc" },
      select: { id: true, name: true, email: true, phone: true, stage: true, courseInterest: true, nextFollowUpAt: true },
    }),
  ]);
  if (!user) throw new PermanentEmailError("User no longer exists");
  if (!leads.length) throw new PermanentEmailError("Every lead in this reminder was deleted");

  const today = new Date().toLocaleDateString("en-CA");
  const due = (d: Date | null) => {
    const ymd = d?.toLocaleDateString("en-CA") ?? today;
    return ymd < today ? `overdue since ${ymd}` : "due today";
  };
  const line = (l: (typeof leads)[number]) =>
    `- ${l.name} <${l.email}>${l.phone ? `, ${l.phone}` : ""}: ${l.stage}${l.courseInterest ? `, ${l.courseInterest}` : ""} (${due(l.nextFollowUpAt)})`;
  const url = `${env.CLIENT_URL}/leads?followUpDue=true`;
  const count = `${leads.length} lead${leads.length === 1 ? "" : "s"}`;

  return {
    subject: `${count} to follow up today`,
    text: `Hi ${user.name},\n\nThese leads need a follow-up:\n\n${leads.map(line).join("\n")}\n\nOpen the list: ${url}`,
    html: layout(
      `${count} to follow up today`,
      `<p>Hi ${esc(user.name)}, these leads need a follow-up:</p>
<table style="width:100%;border-collapse:collapse;font-size:14px">
${leads
  .map(
    (l) => `<tr style="border-top:1px solid #e4e7eb"><td style="padding:8px 0"><b>${esc(l.name)}</b><br><span style="color:#52606d">${esc(l.email)}${l.phone ? ` · ${esc(l.phone)}` : ""}</span></td>
<td style="padding:8px 0;text-align:right">${esc(l.stage)}<br><span style="color:${due(l.nextFollowUpAt).startsWith("overdue") ? "#c81e1e" : "#52606d"}">${esc(due(l.nextFollowUpAt))}</span></td></tr>`,
  )
  .join("\n")}
</table>
${button(url, "Open follow-ups")}`,
    ),
  };
}

async function passwordReset({ userId, sealedToken }: EmailPayloads["password-reset"]): Promise<Rendered> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
  if (!user) throw new PermanentEmailError("User no longer exists");
  const url = `${env.CLIENT_URL}/reset-password?token=${open(sealedToken)}`;
  const note = "This link works once, for 1 hour. If you didn't ask for it, ignore this email: your password stays the same.";
  return {
    subject: "Reset your MiniEdCRM password",
    text: `Hi ${user.name},

Reset your password here: ${url}

${note}`,
    html: layout("Reset your password", `<p>Hi ${esc(user.name)},</p><p>Someone (hopefully you) asked to reset your MiniEdCRM password.</p>${button(url, "Choose a new password")}<p style="color:#52606d;font-size:13px">${esc(note)}</p>`),
  };
}

async function passwordChanged({ userId, how }: EmailPayloads["password-changed"]): Promise<Rendered> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
  if (!user) throw new PermanentEmailError("User no longer exists");
  const what = how === "reset" ? "was reset using a reset link" : "was changed";
  const warning = `If this wasn't you, reset it now at ${env.CLIENT_URL}/forgot-password and tell your institute's admin.`;
  return {
    subject: "Your MiniEdCRM password was changed",
    text: `Hi ${user.name},

Your password ${what}, and every device was signed out.

${warning}`,
    html: layout("Your password was changed", `<p>Hi ${esc(user.name)},</p><p>Your password ${what}, and every device was signed out.</p><p>${esc(warning)}</p>`),
  };
}

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function paymentReceipt({ paymentId }: EmailPayloads["payment-receipt"]): Promise<Rendered> {
  const p = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { lead: { select: { name: true } }, batch: { select: { name: true, course: true } } },
  });
  if (!p || p.status !== "PAID" || !p.paidAt) throw new PermanentEmailError("Payment not found or not paid");
  const rows: [string, string][] = [
    ["Amount", rupees(p.amountPaise)],
    ["Course", `${p.batch.course} (${p.batch.name})`],
    ["Paid on", p.paidAt.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })],
    ["Payment ID", p.gatewayPaymentId ?? "-"],
    ["Receipt no.", p.id],
  ];
  return {
    subject: `Payment received: ${rupees(p.amountPaise)} for ${p.batch.course}`,
    text: [`Hi ${p.lead.name},`, "Thank you, we've received your payment.", ...rows.map(([k, v]) => `${k}: ${v}`), "Keep this email as your receipt."].join("\n\n"),
    html: layout(
      "Payment received",
      `<p>Hi ${esc(p.lead.name)},</p><p>Thank you, we've received your payment.</p>
<table style="width:100%;border-collapse:collapse;font-size:14px">
${rows.map(([k, v]) => `<tr style="border-top:1px solid #e4e7eb"><td style="padding:8px 0;color:#52606d">${esc(k)}</td><td style="padding:8px 0;text-align:right"><b>${esc(v)}</b></td></tr>`).join("\n")}
</table>
<p style="color:#52606d;font-size:13px">Keep this email as your receipt.</p>`,
    ),
  };
}

const statusText: Record<string, string> = {
  APPLIED: "is back to applied",
  SHORTLISTED: "has been shortlisted",
  INTERVIEW: "has moved to interviews",
  OFFERED: "has an offer",
  HIRED: "is marked as hired. Congratulations!",
  REJECTED: "wasn't taken forward this time",
};

async function applicationUpdate({ applicationId }: EmailPayloads["application-update"]): Promise<Rendered> {
  const a = await prisma.jobApplication.findUnique({
    where: { id: applicationId },
    include: { student: { select: { name: true } }, job: { select: { title: true, company: true } } },
  });
  if (!a || a.status === "WITHDRAWN") throw new PermanentEmailError("Application not found or withdrawn");
  const line = `Your application for ${a.job.title} at ${a.job.company} ${statusText[a.status] ?? "was updated"}.`;
  const url = `${env.CLIENT_URL}/careers`;
  return {
    subject: `${a.job.company}: your application ${a.status === "REJECTED" ? "update" : statusText[a.status]?.split(".")[0] ?? "update"}`,
    text: `Hi ${a.student.name},\n\n${line}\n\nSee your applications: ${url}`,
    html: layout(`${a.job.title} at ${a.job.company}`, `<p>Hi ${esc(a.student.name)},</p><p>${esc(line)}</p>${button(url, "See your applications")}`),
  };
}

const modeText = { ONLINE: "Online", IN_PERSON: "In person", PHONE: "Phone" } as const;

async function interviewScheduled({ interviewId }: EmailPayloads["interview-scheduled"]): Promise<Rendered> {
  const i = await prisma.interview.findUnique({
    where: { id: interviewId },
    include: { application: { include: { student: { select: { name: true } }, job: { select: { title: true, company: true } } } } },
  });
  if (!i) throw new PermanentEmailError("Interview not found");
  const { student, job } = i.application;
  const when = i.scheduledAt.toLocaleString("en-IN", { dateStyle: "full", timeStyle: "short", timeZone: process.env.TZ || "Asia/Kolkata" });
  const rows: [string, string][] = [
    ["When", `${when} (${i.durationMinutes} min)`],
    ["How", modeText[i.mode]],
    ...(i.location ? ([["Where", i.location]] as [string, string][]) : []),
    ...(i.notes ? ([["To prepare", i.notes]] as [string, string][]) : []),
  ];
  const url = `${env.CLIENT_URL}/careers`;
  return {
    subject: `Interview: ${job.title} at ${job.company}, ${when}`,
    text: [`Hi ${student.name},`, `You have an interview for ${job.title} at ${job.company}.`, ...rows.map(([k, v]) => `${k}: ${v}`), `Details: ${url}`].join("\n\n"),
    html: layout(
      `Interview: ${job.title}`,
      `<p>Hi ${esc(student.name)},</p><p>You have an interview with <b>${esc(job.company)}</b>.</p>
<table style="width:100%;border-collapse:collapse;font-size:14px">
${rows.map(([k, v]) => `<tr style="border-top:1px solid #e4e7eb"><td style="padding:8px 0;color:#52606d;vertical-align:top">${esc(k)}</td><td style="padding:8px 0">${esc(v)}</td></tr>`).join("\n")}
</table>${button(url, "See it in MiniEdCRM")}`,
    ),
  };
}

export async function render<T extends EmailTemplate>(template: T, payload: EmailPayloads[T]): Promise<Rendered> {
  switch (template) {
    case "welcome":
      return welcome(payload as EmailPayloads["welcome"]);
    case "quiz-result":
      return quizResult(payload as EmailPayloads["quiz-result"]);
    case "lead-follow-up":
      return leadFollowUp(payload as EmailPayloads["lead-follow-up"]);
    case "password-reset":
      return passwordReset(payload as EmailPayloads["password-reset"]);
    case "password-changed":
      return passwordChanged(payload as EmailPayloads["password-changed"]);
    case "payment-receipt":
      return paymentReceipt(payload as EmailPayloads["payment-receipt"]);
    case "application-update":
      return applicationUpdate(payload as EmailPayloads["application-update"]);
    case "interview-scheduled":
      return interviewScheduled(payload as EmailPayloads["interview-scheduled"]);
    default:
      throw new PermanentEmailError(`Unknown template ${template}`);
  }
}
