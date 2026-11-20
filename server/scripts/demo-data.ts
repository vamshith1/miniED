/**
 * Fills the database with realistic demo data so every part of the app has
 * something to show: mentors, courses (batches), leads at every stage with notes
 * and timelines, enrolled students, attendance, quizzes (with skills, negative
 * marking, a practice set) and attempts, tasks and submissions, payments (paid,
 * failed, not completed), resumes, recruiters with jobs, campus drives,
 * applications, interviews and a hiring test, and an email log.
 *
 *   npm run db:demo              add (or refresh) the demo data
 *   npm run db:demo -- --remove  delete all demo data, leaving everything else alone
 *
 * Everything it creates is marked: emails end in @demo.miniedcrm.test and batch
 * names start with "DEMO-". Running it again replaces the old demo data.
 * Nothing is emailed: rows are written straight to the database.
 *
 * Needs an admin account to exist already (leads and payments are "created by" it).
 * For a database that isn't on this machine, set DEMO_PASSWORD (10+ characters):
 * it's the password for every demo mentor and student account.
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { Prisma, PrismaClient, type AttendanceStatus, type LeadStage } from "@prisma/client";

const DOMAIN = "demo.miniedcrm.test";
const PREFIX = "DEMO-";
const prisma = new PrismaClient();

// ---------- Safety: which database, which password

const host = (() => {
  try {
    return new URL(process.env.DATABASE_URL ?? "").hostname;
  } catch {
    return "";
  }
})();
const isLocal = ["localhost", "127.0.0.1", "::1", "postgres"].includes(host);
const removeOnly = process.argv.includes("--remove");

function fail(message: string): never {
  console.error(`Demo data stopped: ${message}`);
  process.exit(1);
}

const demoPassword = process.env.DEMO_PASSWORD ?? (isLocal ? "Demo@12345!" : "");
if (!removeOnly) {
  if (!demoPassword) fail(`database ${host} isn't local, so set DEMO_PASSWORD (10+ characters) for the demo accounts.`);
  if (!isLocal && demoPassword.length < 10) fail("DEMO_PASSWORD must be at least 10 characters.");
}

// ---------- Helpers

// Same random numbers every run, so the demo looks the same each time.
let seed = 20261119;
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
const between = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const id = (prefix: string) => `${prefix}_demo_${randomBytes(8).toString("hex")}`;

const DAY = 24 * 3600 * 1000;
const now = new Date();
const daysAgo = (d: number, hour = 11) => {
  const x = new Date(now.getTime() - d * DAY);
  x.setHours(hour, between(0, 59), 0, 0);
  return x;
};
// Date-only values are stored as UTC midnight (see src/lib/dates.ts).
const dateOnly = (d: Date) => new Date(`${d.toLocaleDateString("en-CA")}T00:00:00.000Z`);
const daysFromToday = (d: number) => dateOnly(new Date(now.getTime() + d * DAY));
const email = (name: string) => `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@${DOMAIN}`;
const phone = () => `9${between(100000000, 999999999)}`;

// ---------- Remove

async function removeDemo() {
  const demoUsers = { email: { endsWith: `@${DOMAIN}` } };
  const demoBatches = { name: { startsWith: PREFIX } };
  const r = await prisma.$transaction([
    prisma.payment.deleteMany({ where: { OR: [{ lead: demoUsers }, { batch: demoBatches }] } }),
    prisma.lead.deleteMany({ where: demoUsers }), // notes and timeline go with them
    // Jobs posted by demo recruiters: their applications, interviews and hiring tests go with them.
    prisma.job.deleteMany({ where: { postedBy: demoUsers } }),
    prisma.quiz.deleteMany({ where: { OR: [{ batch: demoBatches }, { createdBy: demoUsers }] } }), // questions and attempts too
    prisma.task.deleteMany({ where: { OR: [{ batch: demoBatches }, { createdBy: demoUsers }] } }), // and what was handed in
    prisma.attendance.deleteMany({ where: { OR: [{ batch: demoBatches }, { student: demoUsers }] } }),
    prisma.emailLog.deleteMany({ where: { to: { endsWith: `@${DOMAIN}` } } }),
    prisma.user.deleteMany({ where: demoUsers }), // their resumes and attempts too
    prisma.batch.deleteMany({ where: demoBatches }),
  ]);
  return { payments: r[0].count, leads: r[1].count, jobs: r[2].count, quizzes: r[3].count, users: r[7].count, batches: r[8].count };
}

if (removeOnly) {
  const r = await removeDemo();
  console.log(`✔ Removed demo data: ${r.batches} batches, ${r.users} people, ${r.leads} leads, ${r.quizzes} quizzes, ${r.jobs} jobs, ${r.payments} payments.`);
  await prisma.$disconnect();
  process.exit(0);
}

// ---------- Add

const admin = await prisma.user.findFirst({ where: { role: "ADMIN", isActive: true }, orderBy: { createdAt: "asc" } });
if (!admin) fail("there's no admin account yet. Create one first (npm run db:seed or scripts/create-admin.ps1).");

const old = await removeDemo();
if (old.batches || old.leads) console.log("Replacing the previous demo data…");

const passwordHash = await bcrypt.hash(demoPassword, 10);

// Mentors
const [ananya, karthik] = await Promise.all(
  [
    ["Ananya Rao", "Full stack developer, 6 years at product startups"],
    ["Karthik Menon", "Data scientist, ex-analytics lead"],
  ].map(([name]) => prisma.user.create({ data: { name, email: email(name), phone: phone(), role: "MENTOR", passwordHash } })),
);

// Courses (batches)
const courses = [
  { name: `${PREFIX}FS-Web`, course: "Full Stack Web Development", start: -45, end: 60, fee: 2_500_000, classMinutes: 120, mentor: ananya },
  { name: `${PREFIX}DS-Python`, course: "Data Science with Python", start: -30, end: 75, fee: 3_000_000, classMinutes: 90, mentor: karthik },
  { name: `${PREFIX}UI-UX`, course: "UI/UX Design Basics", start: 10, end: 70, fee: 1_500_000, classMinutes: 60, mentor: ananya },
];
const batches = await Promise.all(
  courses.map((c) =>
    prisma.batch.create({
      data: {
        name: c.name,
        course: c.course,
        startDate: daysFromToday(c.start),
        endDate: daysFromToday(c.end),
        feePaise: c.fee,
        classMinutes: c.classMinutes,
        mentorId: c.mentor.id,
        // Students who sign up themselves can join the running web batch and the upcoming design one with a code.
        joinCode: c.name.endsWith("FS-Web") ? "DEMOWEB1" : c.name.endsWith("UI-UX") ? "DEMOUX24" : null,
      },
    }),
  ),
);
const [fsBatch, dsBatch, uxBatch] = batches;

// ---------- Leads and students

const SOURCES = ["Website", "Referral", "Instagram", "Walk-in", "Google Ads", "CSV import"];
type LeadPlan = {
  name: string;
  stage: LeadStage;
  course: string;
  createdDaysAgo: number;
  followUp?: number; // days from today; negative = overdue
  assignee?: "ananya" | "karthik" | "admin";
  notes?: string[];
  enrollIn?: typeof fsBatch;
  payment?: "paid" | "failed-then-paid" | "scholarship" | "failed" | "pending";
  skill?: number; // 0..1, how well this student does in quizzes
  attendance?: number; // 0..1, how often they come to class
  resume?: boolean;
};

const plans: LeadPlan[] = [
  // Enrolled in Full Stack
  { name: "Aarav Sharma", stage: "ENROLLED", course: "Full Stack Web Development", createdDaysAgo: 55, enrollIn: fsBatch, payment: "paid", skill: 0.92, attendance: 0.96, resume: true, notes: ["Strong JavaScript basics, wants to move into product companies."] },
  { name: "Diya Patel", stage: "ENROLLED", course: "Full Stack Web Development", createdDaysAgo: 52, enrollIn: fsBatch, payment: "paid", skill: 0.85, attendance: 0.9, resume: true },
  { name: "Rohan Gupta", stage: "ENROLLED", course: "Full Stack Web Development", createdDaysAgo: 50, enrollIn: fsBatch, payment: "failed-then-paid", skill: 0.6, attendance: 0.7, notes: ["First card payment was declined; paid by UPI the same day."] },
  { name: "Sneha Reddy", stage: "ENROLLED", course: "Full Stack Web Development", createdDaysAgo: 48, enrollIn: fsBatch, payment: "paid", skill: 0.75, attendance: 0.85 },
  { name: "Vikram Singh", stage: "ENROLLED", course: "Full Stack Web Development", createdDaysAgo: 47, enrollIn: fsBatch, payment: "scholarship", skill: 0.5, attendance: 0.62, notes: ["Merit scholarship approved, fee waived."] },
  { name: "Meera Iyer", stage: "ENROLLED", course: "Full Stack Web Development", createdDaysAgo: 46, enrollIn: fsBatch, payment: "paid", skill: 0.88, attendance: 0.93, resume: true },
  // Enrolled in Data Science
  { name: "Arjun Nair", stage: "ENROLLED", course: "Data Science with Python", createdDaysAgo: 40, enrollIn: dsBatch, payment: "paid", skill: 0.8, attendance: 0.9 },
  { name: "Kavya Joshi", stage: "ENROLLED", course: "Data Science with Python", createdDaysAgo: 38, enrollIn: dsBatch, payment: "paid", skill: 0.95, attendance: 0.97 },
  { name: "Ishaan Verma", stage: "ENROLLED", course: "Data Science with Python", createdDaysAgo: 36, enrollIn: dsBatch, payment: "paid", skill: 0.55, attendance: 0.68 },
  { name: "Priya Krishnan", stage: "ENROLLED", course: "Data Science with Python", createdDaysAgo: 35, enrollIn: dsBatch, payment: "paid", skill: 0.7, attendance: 0.8 },
  { name: "Aditya Kulkarni", stage: "ENROLLED", course: "Data Science with Python", createdDaysAgo: 33, enrollIn: dsBatch, payment: "paid", skill: 0.65, attendance: 0.74 },
  // Open leads at every stage
  { name: "Neha Bansal", stage: "NEW", course: "UI/UX Design Basics", createdDaysAgo: 1, followUp: 0, assignee: "ananya" },
  { name: "Rahul Mehta", stage: "NEW", course: "Full Stack Web Development", createdDaysAgo: 3, followUp: -1, assignee: "admin" },
  { name: "Tanvi Desai", stage: "NEW", course: "Data Science with Python", createdDaysAgo: 6 },
  { name: "Siddharth Rao", stage: "CONTACTED", course: "Full Stack Web Development", createdDaysAgo: 9, followUp: 2, assignee: "ananya", notes: ["Called, asked for weekend batch timings."] },
  { name: "Pooja Agarwal", stage: "CONTACTED", course: "UI/UX Design Basics", createdDaysAgo: 12, followUp: -3, assignee: "admin", notes: ["Sent the brochure on WhatsApp."] },
  { name: "Karan Malhotra", stage: "CONTACTED", course: "Data Science with Python", createdDaysAgo: 16, followUp: 1, assignee: "karthik" },
  { name: "Ananya Pillai", stage: "INTERESTED", course: "UI/UX Design Basics", createdDaysAgo: 8, followUp: 0, assignee: "ananya", notes: ["Wants to join the upcoming UI/UX batch."], payment: "pending" },
  { name: "Manish Tiwari", stage: "INTERESTED", course: "Full Stack Web Development", createdDaysAgo: 14, followUp: 3, assignee: "admin", notes: ["Card declined at checkout, will retry with UPI."], payment: "failed" },
  { name: "Ritika Saxena", stage: "INTERESTED", course: "Data Science with Python", createdDaysAgo: 20, followUp: -2, assignee: "karthik", notes: ["Comparing with another institute; offered a demo class."] },
  { name: "Yash Chauhan", stage: "LOST", course: "Full Stack Web Development", createdDaysAgo: 27, notes: ["Joined a college course instead."] },
  { name: "Simran Kaur", stage: "LOST", course: "Data Science with Python", createdDaysAgo: 31, notes: ["Budget constraints this year."] },
  { name: "Nikhil Jain", stage: "LOST", course: "UI/UX Design Basics", createdDaysAgo: 44 },
];

const assigneeId = (a?: LeadPlan["assignee"]) => (a === "ananya" ? ananya.id : a === "karthik" ? karthik.id : a === "admin" ? admin.id : null);
const mentorFor = (b: typeof fsBatch) => (b.id === dsBatch.id ? karthik : ananya);

type Student = { id: string; name: string; email: string; batchId: string; skill: number; attendance: number };
const students: Student[] = [];
let leadCount = 0;
let paymentCount = 0;

for (const p of plans) {
  const created = daysAgo(p.createdDaysAgo, between(9, 18));
  const at = (d: number) => new Date(created.getTime() + d * DAY + between(0, 3) * 3600 * 1000);
  const leadEmail = email(p.name);
  const actor = p.enrollIn ? mentorFor(p.enrollIn).id : (assigneeId(p.assignee) ?? admin.id);

  // Stages walked through on the timeline, oldest first.
  const path: LeadStage[] =
    p.stage === "NEW" ? [] : p.stage === "CONTACTED" ? ["CONTACTED"] : p.stage === "INTERESTED" ? ["CONTACTED", "INTERESTED"] : p.stage === "LOST" ? ["CONTACTED", "LOST"] : ["CONTACTED", "INTERESTED"];

  const lead = await prisma.lead.create({
    data: {
      name: p.name,
      email: leadEmail,
      phone: phone(),
      source: pick(SOURCES),
      courseInterest: p.course,
      stage: p.stage === "ENROLLED" ? "INTERESTED" : p.stage, // set to ENROLLED with the conversion below
      nextFollowUpAt: p.followUp === undefined || p.stage === "LOST" ? null : daysAgo(-p.followUp, 10),
      createdAt: created,
      createdById: admin.id,
      assignedToId: p.enrollIn ? mentorFor(p.enrollIn).id : assigneeId(p.assignee),
    },
  });
  leadCount++;

  const activities: Prisma.LeadActivityCreateManyInput[] = [{ leadId: lead.id, type: "CREATED", actorId: admin.id, createdAt: created }];
  let from: LeadStage = "NEW";
  path.forEach((to, i) => {
    activities.push({ leadId: lead.id, type: "STAGE_CHANGED", actorId: actor, meta: { from, to }, createdAt: at(1 + i * 2) });
    from = to;
  });
  (p.notes ?? []).forEach((body, i) => {
    activities.push({ leadId: lead.id, type: "NOTE_ADDED", actorId: actor, meta: { preview: body.slice(0, 80) }, createdAt: at(2 + i) });
  });
  if (p.notes?.length) {
    await prisma.leadNote.createMany({ data: p.notes.map((body, i) => ({ leadId: lead.id, authorId: actor, body, createdAt: at(2 + i) })) });
  }

  // Payments for leads that never enrolled: a failed attempt, or a checkout left open.
  if (!p.enrollIn && (p.payment === "failed" || p.payment === "pending")) {
    const batch = p.course.startsWith("UI") ? uxBatch : p.course.startsWith("Data") ? dsBatch : fsBatch;
    await prisma.payment.create({
      data: {
        amountPaise: batch.feePaise!,
        provider: "demo",
        gatewayOrderId: id("order"),
        status: p.payment === "failed" ? "FAILED" : "CREATED",
        failureReason: p.payment === "failed" ? "Card declined by the bank" : null,
        createdAt: at(4),
        leadId: lead.id,
        batchId: batch.id,
        createdById: admin.id,
      },
    });
    paymentCount++;
  }

  // Enrolled: payment, student account, conversion.
  if (p.enrollIn) {
    const batch = p.enrollIn;
    const enrolledAt = at(5);
    if (p.payment === "failed-then-paid") {
      await prisma.payment.create({
        data: { amountPaise: batch.feePaise!, provider: "demo", gatewayOrderId: id("order"), status: "FAILED", failureReason: "Card declined by the bank", createdAt: at(4), leadId: lead.id, batchId: batch.id, createdById: admin.id },
      });
      paymentCount++;
    }
    if (p.payment === "paid" || p.payment === "failed-then-paid") {
      const payment = await prisma.payment.create({
        data: {
          amountPaise: batch.feePaise!,
          provider: "demo",
          gatewayOrderId: id("order"),
          gatewayPaymentId: id("pay"),
          status: "PAID",
          createdAt: enrolledAt,
          paidAt: enrolledAt,
          leadId: lead.id,
          batchId: batch.id,
          createdById: admin.id,
        },
      });
      paymentCount++;
      activities.push({
        leadId: lead.id,
        type: "PAYMENT_RECEIVED",
        actorId: admin.id,
        meta: { paymentId: payment.id, amountPaise: payment.amountPaise, currency: "INR", batchName: batch.name, via: "checkout" },
        createdAt: enrolledAt,
      });
    }
    const student = await prisma.user.create({
      data: { name: p.name, email: leadEmail, phone: lead.phone, role: "STUDENT", passwordHash, batchId: batch.id, createdAt: enrolledAt },
    });
    await prisma.lead.update({ where: { id: lead.id }, data: { stage: "ENROLLED", nextFollowUpAt: null, convertedUserId: student.id } });
    activities.push({
      leadId: lead.id,
      type: "CONVERTED",
      actorId: admin.id,
      meta: { from: "INTERESTED", studentId: student.id, batchId: batch.id, batchName: batch.name },
      createdAt: new Date(enrolledAt.getTime() + 60_000),
    });
    students.push({ id: student.id, name: p.name, email: leadEmail, batchId: batch.id, skill: p.skill ?? 0.7, attendance: p.attendance ?? 0.85 });

    if (p.resume) {
      const pdf = Buffer.from(
        `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 400 140]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length 70>>stream\nBT /F1 18 Tf 24 80 Td (${p.name} - Resume \\(demo\\)) Tj ET\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n`,
      );
      await prisma.document.create({
        data: {
          kind: "RESUME",
          originalName: `${p.name.replace(/ /g, "_")}_Resume.pdf`,
          storedName: randomBytes(16).toString("hex"),
          mimeType: "application/pdf",
          sizeBytes: pdf.length,
          ownerId: student.id,
          createdAt: new Date(enrolledAt.getTime() + 3 * DAY),
          blob: { create: { data: pdf } },
        },
      });
    }
  }

  await prisma.leadActivity.createMany({ data: activities });
}

// ---------- Attendance: every weekday from the batch start up to yesterday

let attendanceCount = 0;
for (const batch of [fsBatch, dsBatch]) {
  const mentor = mentorFor(batch);
  const rows: Prisma.AttendanceCreateManyInput[] = [];
  for (let d = new Date(batch.startDate); d < dateOnly(now); d = new Date(d.getTime() + DAY)) {
    const weekday = d.getUTCDay();
    if (weekday === 0 || weekday === 6) continue; // no classes at the weekend
    for (const s of students.filter((x) => x.batchId === batch.id)) {
      const r = rand();
      const status: AttendanceStatus = r < s.attendance - 0.07 ? "PRESENT" : r < s.attendance ? "LATE" : "ABSENT";
      rows.push({ batchId: batch.id, studentId: s.id, markedById: mentor.id, date: d, status, createdAt: new Date(d.getTime() + 18 * 3600 * 1000) });
    }
  }
  await prisma.attendance.createMany({ data: rows });
  attendanceCount += rows.length;
}

// ---------- Quizzes with attempts

type Q = { text: string; options: string[]; correct: number; points?: number; skill: string; why?: string };
type QuizPlan = {
  batch: typeof fsBatch;
  title: string;
  description: string;
  minutes: number;
  daysAgo: number;
  published: boolean;
  practice?: boolean;
  negativePercent?: number;
  passPercent?: number;
  questions: Q[];
};
const quizzes: QuizPlan[] = [
  {
    batch: fsBatch, title: "HTML Basics", description: "Tags, attributes and page structure.", minutes: 5, daysAgo: 35, published: true, passPercent: 50,
    questions: [
      { text: "Which tag makes the largest heading?", options: ["<h6>", "<h1>", "<head>", "<header>"], correct: 1, skill: "HTML", why: "Headings go from <h1> (largest, most important) down to <h6>." },
      { text: "Which attribute gives an image its text alternative?", options: ["title", "src", "alt", "name"], correct: 2, skill: "Accessibility", why: "Screen readers read the alt text; it also shows if the image fails to load." },
      { text: "Which element is used for a link?", options: ["<a>", "<link>", "<href>", "<url>"], correct: 0, skill: "HTML", why: "<a href=\"…\"> is a hyperlink. <link> connects the page to stylesheets and other resources." },
      { text: "Where does the <title> element go?", options: ["<body>", "<footer>", "<head>", "<main>"], correct: 2, points: 2, skill: "HTML", why: "Page metadata, including <title>, belongs in <head>." },
    ],
  },
  {
    batch: fsBatch, title: "CSS Layout", description: "Box model, flexbox and grid.", minutes: 6, daysAgo: 21, published: true, passPercent: 60,
    questions: [
      { text: "Which display value lays children in a row by default?", options: ["block", "flex", "inline", "none"], correct: 1, skill: "CSS layout", why: "A flex container's default flex-direction is row." },
      { text: "Which property adds space inside the border?", options: ["margin", "gap", "padding", "outline"], correct: 2, skill: "CSS box model", why: "Padding is inside the border; margin is outside it." },
      { text: "Which unit is relative to the root font size?", options: ["em", "rem", "px", "vh"], correct: 1, skill: "CSS box model", why: "rem = root em, the <html> element's font size. em follows the parent." },
      { text: "Which grid property sets the columns?", options: ["grid-template-columns", "grid-columns", "columns", "grid-area"], correct: 0, points: 2, skill: "CSS layout", why: "grid-template-columns: 1fr 2fr; defines the column tracks." },
    ],
  },
  {
    batch: fsBatch, title: "JavaScript Fundamentals", description: "Variables, types and arrays. Wrong answers cost a quarter of the points, so skip what you don't know.", minutes: 8, daysAgo: 7, published: true, negativePercent: 25, passPercent: 60,
    questions: [
      { text: "Which keyword declares a constant?", options: ["var", "let", "const", "static"], correct: 2, skill: "JavaScript basics", why: "const can't be reassigned; let can; var is the old function-scoped form." },
      { text: "What does typeof null return?", options: ['"null"', '"object"', '"undefined"', '"number"'], correct: 1, skill: "JavaScript types", why: "A long-standing quirk of JavaScript: typeof null is \"object\"." },
      { text: "Which method adds an item to the end of an array?", options: ["push()", "pop()", "shift()", "unshift()"], correct: 0, skill: "Arrays", why: "push adds to the end, pop removes from the end; unshift/shift work at the start." },
      { text: 'What is 2 + "2" in JavaScript?', options: ["4", '"22"', "NaN", "an error"], correct: 1, points: 2, skill: "JavaScript types", why: "With a string on either side, + joins them as text." },
      { text: "Which is NOT a primitive type?", options: ["string", "boolean", "object", "symbol"], correct: 2, points: 2, skill: "JavaScript types", why: "Objects (including arrays and functions) are reference types; the rest are primitives." },
    ],
  },
  {
    batch: fsBatch, title: "JavaScript Practice Set", description: "Warm up before the next test. Take it as often as you like.", minutes: 10, daysAgo: 5, published: true, practice: true,
    questions: [
      { text: "What does [1, 2, 3].map(x => x * 2) return?", options: ["[2, 4, 6]", "[1, 2, 3]", "12", "undefined"], correct: 0, skill: "Arrays", why: "map builds a new array from what the function returns for each item." },
      { text: "Which compares without converting types?", options: ["==", "===", "=", "!="], correct: 1, skill: "JavaScript types", why: "=== checks value and type; == converts first (\"1\" == 1 is true)." },
      { text: "What does .filter() return?", options: ["The first match", "A new array of matches", "true or false", "The count"], correct: 1, skill: "Arrays", why: "filter keeps every item the function returns true for, in a new array." },
    ],
  },
  {
    batch: fsBatch, title: "React Components", description: "Props, state and effects.", minutes: 10, daysAgo: 1, published: false,
    questions: [{ text: "Which hook stores component state?", options: ["useEffect", "useState", "useMemo", "useRef"], correct: 1, skill: "React", why: "useState returns the value and a setter that re-renders the component." }],
  },
  {
    batch: dsBatch, title: "Python Basics", description: "Types, lists and loops.", minutes: 6, daysAgo: 22, published: true, passPercent: 50,
    questions: [
      { text: "What does len([1, 2, 3]) return?", options: ["2", "3", "4", "an error"], correct: 1, skill: "Python basics", why: "len counts the items: there are 3." },
      { text: "Which type is immutable?", options: ["list", "dict", "set", "tuple"], correct: 3, skill: "Python data types", why: "Tuples can't be changed after they're made; lists, dicts and sets can." },
      { text: "What does range(3) produce?", options: ["1, 2, 3", "0, 1, 2", "0, 1, 2, 3", "3"], correct: 1, skill: "Python basics", why: "range starts at 0 and stops before the end value." },
      { text: "Which keyword defines a function?", options: ["func", "def", "lambda", "function"], correct: 1, points: 2, skill: "Python basics", why: "def name(): defines a function; lambda makes a small anonymous one." },
    ],
  },
  {
    batch: dsBatch, title: "Pandas Essentials", description: "DataFrames, filtering and grouping.", minutes: 8, daysAgo: 8, published: true, negativePercent: 25, passPercent: 50,
    questions: [
      { text: "Which function reads a CSV file?", options: ["pd.load_csv", "pd.read_csv", "pd.open", "pd.csv"], correct: 1, skill: "Pandas", why: "pd.read_csv(\"file.csv\") returns a DataFrame." },
      { text: "How do you see the first 5 rows?", options: ["df.first()", "df.top()", "df.head()", "df.show()"], correct: 2, skill: "Pandas", why: "head() shows 5 rows by default; head(10) shows 10." },
      { text: "Which method groups rows by a column?", options: ["df.group()", "df.groupby()", "df.split()", "df.pivot()"], correct: 1, points: 2, skill: "Data aggregation", why: "df.groupby(\"col\").mean() averages each group." },
      { text: "Which gives the number of rows and columns?", options: ["df.size", "df.len", "df.shape", "df.count"], correct: 2, points: 2, skill: "Pandas", why: "shape is a (rows, columns) tuple; size is rows × columns." },
    ],
  },
];

let attemptCount = 0;
let practiceCount = 0;
for (const qz of quizzes) {
  const mentor = mentorFor(qz.batch);
  const quiz = await prisma.quiz.create({
    data: {
      title: qz.title,
      description: qz.description,
      durationSeconds: qz.minutes * 60,
      isPublished: qz.published,
      mode: qz.practice ? "PRACTICE" : "TEST",
      negativePercent: qz.negativePercent ?? 0,
      passPercent: qz.passPercent ?? null,
      batchId: qz.batch.id,
      createdById: mentor.id,
      createdAt: daysAgo(qz.daysAgo + 1),
      questions: {
        create: qz.questions.map((q, qi) => ({
          text: q.text,
          points: q.points ?? 1,
          skill: q.skill,
          explanation: q.why ?? null,
          position: qi,
          options: { create: q.options.map((text, oi) => ({ text, isCorrect: oi === q.correct, position: oi })) },
        })),
      },
    },
    include: { questions: { include: { options: true }, orderBy: { position: "asc" } } },
  });
  if (!qz.published) continue;

  const maxScore = quiz.questions.reduce((s, q) => s + q.points, 0);
  const roster = students.filter((s) => s.batchId === qz.batch.id);
  // One go's answers: right with the student's skill; when wrong, sometimes skipped instead
  // (more often when wrong answers cost marks).
  const answer = (s: Student) =>
    quiz.questions.map((q) => {
      const right = rand() < s.skill;
      const skipped = !right && rand() < (qz.negativePercent ? 0.45 : 0.2);
      const option = right ? q.options.find((o) => o.isCorrect)! : q.options.find((o) => !o.isCorrect)!;
      return { questionId: q.id, optionId: skipped ? null : option.id, isCorrect: right, points: q.points };
    });
  const scoreOf = (answers: ReturnType<typeof answer>) => {
    const raw = answers.reduce((t, a) => t + (a.isCorrect ? a.points : a.optionId ? -(a.points * (qz.negativePercent ?? 0)) / 100 : 0), 0);
    return Math.round(Math.max(0, raw) * 100) / 100;
  };

  if (qz.practice) {
    // A few goes each for some students, getting better over time.
    for (const s of roster.slice(0, 4)) {
      for (let go = 0; go < between(1, 3); go++) {
        const answers = answer({ ...s, skill: Math.min(1, s.skill + go * 0.1) });
        await prisma.practiceRun.create({
          data: {
            quizId: quiz.id,
            studentId: s.id,
            score: scoreOf(answers),
            maxScore,
            correct: answers.filter((a) => a.isCorrect).length,
            wrong: answers.filter((a) => !a.isCorrect && a.optionId).length,
            skipped: answers.filter((a) => !a.optionId).length,
            timeTakenMs: between(60, 300) * 1000,
            createdAt: daysAgo(qz.daysAgo - go, between(17, 22)),
          },
        });
        practiceCount++;
      }
    }
    continue;
  }

  for (const [i, s] of roster.entries()) {
    if (i === roster.length - 1 && qz.daysAgo < 10) continue; // one student hasn't taken the newest quiz yet
    const startedAt = daysAgo(qz.daysAgo - between(0, 2), between(16, 21));
    const expired = s.skill < 0.6 && qz.title === "CSS Layout"; // ran out of time
    const answers = answer(s);
    const score = expired ? 0 : scoreOf(answers);
    const timeTakenMs = expired ? null : Math.round(qz.minutes * 60_000 * (0.35 + rand() * 0.55));
    await prisma.quizAttempt.create({
      data: {
        quizId: quiz.id,
        studentId: s.id,
        status: expired ? "EXPIRED" : "SUBMITTED",
        startedAt,
        submittedAt: new Date(startedAt.getTime() + (timeTakenMs ?? qz.minutes * 60_000 + 30_000)),
        score,
        maxScore,
        timeTakenMs,
        answers: expired ? undefined : { create: answers.map(({ questionId, optionId, isCorrect }) => ({ questionId, optionId, isCorrect })) },
      },
    });
    attemptCount++;
  }
}

// ---------- Tasks and what students handed in

type TaskPlan = { batch: typeof fsBatch; title: string; description: string; dueInDays: number; points: number | null; createdDaysAgo: number };
const taskPlans: TaskPlan[] = [
  { batch: fsBatch, title: "Personal portfolio page", description: "One responsive HTML/CSS page about you: intro, skills, two projects, contact. Host it on GitHub Pages and send the link.", dueInDays: -12, points: 10, createdDaysAgo: 20 },
  { batch: fsBatch, title: "JavaScript array exercises", description: "Solve the 10 exercises in the starter repo with map, filter and reduce. Push your solutions.", dueInDays: -2, points: 20, createdDaysAgo: 9 },
  { batch: fsBatch, title: "Todo app with React", description: "Add, complete and delete todos, saved in localStorage. Bonus: filters.", dueInDays: 6, points: 30, createdDaysAgo: 1 },
  { batch: dsBatch, title: "Explore the Titanic dataset", description: "In a notebook: load the CSV, clean missing ages, and chart survival by class and sex. Share the notebook link.", dueInDays: -3, points: 20, createdDaysAgo: 12 },
  { batch: dsBatch, title: "Read: Tidy Data", description: "Read the Tidy Data paper and write 5 lines on what you'd change in your Titanic notebook.", dueInDays: 4, points: null, createdDaysAgo: 2 },
];
let taskCount = 0;
let submissionCount = 0;
for (const t of taskPlans) {
  const mentor = mentorFor(t.batch);
  const due = new Date(now.getTime() + t.dueInDays * DAY);
  due.setHours(23, 59, 0, 0);
  const task = await prisma.task.create({
    data: { title: t.title, description: t.description, dueAt: due, maxPoints: t.points, batchId: t.batch.id, createdById: mentor.id, createdAt: daysAgo(t.createdDaysAgo) },
  });
  taskCount++;
  const roster = students.filter((s) => s.batchId === t.batch.id);
  for (const s of roster) {
    // Better students hand in more often; future tasks only some have started.
    const handsIn = t.dueInDays > 0 ? rand() < s.skill - 0.4 : rand() < s.attendance;
    if (!handsIn) continue;
    const late = t.dueInDays < 0 && rand() < 0.2;
    const planned = late ? new Date(due.getTime() + between(2, 30) * 3600 * 1000) : new Date(due.getTime() - between(4, 72) * 3600 * 1000);
    // Never in the future (work on a task that isn't due yet was handed in recently).
    const submittedAt = planned > now ? new Date(now.getTime() - between(2, 30) * 3600 * 1000) : planned;
    const reviewed = t.dueInDays < 0;
    const good = s.skill > 0.65;
    const status = !reviewed ? "SUBMITTED" : good ? "ACCEPTED" : rand() < 0.5 ? "CHANGES_REQUESTED" : "SUBMITTED";
    const slug = s.name.toLowerCase().replace(/[^a-z]+/g, "-");
    await prisma.taskSubmission.create({
      data: {
        taskId: task.id,
        studentId: s.id,
        link: t.batch.id === dsBatch.id ? `https://colab.research.google.com/drive/demo-${slug}` : `https://github.com/${slug}/${t.title.toLowerCase().replace(/[^a-z]+/g, "-")}`,
        note: rand() < 0.4 ? "Done. The responsive part took the longest." : null,
        status,
        points: status === "ACCEPTED" && t.points ? Math.round(t.points * (0.6 + s.skill * 0.4)) : null,
        feedback: status === "ACCEPTED" ? pick(["Clean work, well done.", "Nice. Next time add a README.", "Great structure and naming."]) : status === "CHANGES_REQUESTED" ? "Close! Fix the layout on mobile and hand in again." : null,
        submittedAt,
        reviewedAt: status === "SUBMITTED" ? null : new Date(Math.min(submittedAt.getTime() + DAY, now.getTime())),
        reviewedById: status === "SUBMITTED" ? null : mentor.id,
      },
    });
    submissionCount++;
  }
}

// ---------- Recruiters, jobs, campus drives, applications and interviews

const [technova, dataworks] = await Promise.all(
  [
    ["Neha Kapoor", "TechNova Solutions"],
    ["Rajiv Bose", "DataWorks Analytics"],
  ].map(([name, company]) => prisma.user.create({ data: { name, email: email(name), phone: phone(), role: "RECRUITER", company, passwordHash } })),
);

// About half the students share their profile with recruiters.
const sharing = students.filter((_, i) => i % 2 === 0);
await prisma.user.updateMany({ where: { id: { in: sharing.map((s) => s.id) } }, data: { shareProfile: true } });

const inDays = (d: number) => new Date(now.getTime() + d * DAY);
const jobPlans = [
  {
    by: technova, title: "Frontend Developer Intern", type: "INTERNSHIP" as const, location: "Bengaluru (hybrid)", salary: "₹25,000 / month",
    skills: ["HTML", "CSS layout", "JavaScript basics", "React"], minReadiness: 60, deadline: inDays(10), batches: [fsBatch], createdDaysAgo: 6,
    description: "Six-month internship on our customer dashboard team. You'll build React screens with designers and ship to production every week. Strong HTML/CSS and JavaScript basics needed; React is a plus.",
  },
  {
    by: technova, title: "Junior Full Stack Developer", type: "FULL_TIME" as const, location: "Remote (India)", salary: "₹6–8 LPA",
    skills: ["JavaScript", "React", "Node.js", "SQL"], minReadiness: null, deadline: inDays(21), batches: [], createdDaysAgo: 3,
    description: "Work across our React front end and Node.js API. You'll pair with senior engineers, write tests and own small features end to end.",
  },
  {
    by: dataworks, title: "Data Analyst Trainee", type: "FULL_TIME" as const, location: "Hyderabad", salary: "₹4.5–5.5 LPA",
    skills: ["Python basics", "Pandas", "Data aggregation", "SQL"], minReadiness: 55, deadline: inDays(8), batches: [dsBatch], createdDaysAgo: 5,
    description: "Campus drive for the data science batch. Clean and analyse client data in Python and build weekly reports. Training provided for SQL and dashboards.",
  },
  {
    by: dataworks, title: "Business Intelligence Intern", type: "INTERNSHIP" as const, location: "Hyderabad", salary: "₹15,000 / month",
    skills: ["Excel", "SQL"], minReadiness: null, deadline: inDays(-4), batches: [], createdDaysAgo: 25, closed: true,
    description: "A three-month internship building dashboards. Applications have closed.",
  },
];

let jobCount = 0;
let applicationCount = 0;
let interviewCount = 0;
const jobs: { id: string; plan: (typeof jobPlans)[number] }[] = [];
for (const j of jobPlans) {
  const job = await prisma.job.create({
    data: {
      title: j.title,
      company: j.by.company!,
      location: j.location,
      type: j.type,
      salary: j.salary,
      description: j.description,
      skills: j.skills,
      minReadiness: j.minReadiness,
      deadline: j.deadline,
      status: "closed" in j && j.closed ? "CLOSED" : "OPEN",
      isCampusDrive: j.batches.length > 0,
      postedById: j.by.id,
      createdAt: daysAgo(j.createdDaysAgo),
      batches: { connect: j.batches.map((b) => ({ id: b.id })) },
    },
  });
  jobs.push({ id: job.id, plan: j });
  jobCount++;
}

// Who applied where, and how far they got.
const fsStudents = students.filter((s) => s.batchId === fsBatch.id).sort((a, b) => b.skill - a.skill);
const dsStudents = students.filter((s) => s.batchId === dsBatch.id).sort((a, b) => b.skill - a.skill);
const [internJob, fullStackJob, analystJob] = jobs;
const pipeline: { job: (typeof jobs)[number]; student: Student; status: "APPLIED" | "SHORTLISTED" | "INTERVIEW" | "OFFERED" | "REJECTED"; note?: string }[] = [
  { job: internJob, student: fsStudents[0], status: "OFFERED", note: "I built my portfolio and the todo app in React and would love to work on a real product." },
  { job: internJob, student: fsStudents[1], status: "INTERVIEW" },
  { job: internJob, student: fsStudents[2], status: "SHORTLISTED" },
  { job: internJob, student: fsStudents[3], status: "APPLIED" },
  { job: fullStackJob, student: fsStudents[0], status: "APPLIED" },
  { job: fullStackJob, student: fsStudents[4], status: "REJECTED" },
  { job: fullStackJob, student: dsStudents[0], status: "APPLIED", note: "Moving from data into full stack; comfortable with Python and SQL." },
  { job: analystJob, student: dsStudents[0], status: "INTERVIEW" },
  { job: analystJob, student: dsStudents[1], status: "SHORTLISTED" },
  { job: analystJob, student: dsStudents[2], status: "APPLIED" },
];
const appIds = new Map<string, string>();
for (const p of pipeline) {
  if (!p.student) continue;
  // Applied soon after the job went up (so before the screening test three days ago).
  const last = Math.max(1, p.job.plan.createdDaysAgo - 1);
  const createdAt = daysAgo(between(Math.min(4, last), last));
  const app = await prisma.jobApplication.create({
    data: { jobId: p.job.id, studentId: p.student.id, status: p.status, coverNote: p.note ?? null, createdAt },
  });
  appIds.set(`${p.job.id}:${p.student.id}`, app.id);
  applicationCount++;
  if (p.status === "INTERVIEW" || p.status === "OFFERED") {
    const done = p.status === "OFFERED";
    await prisma.interview.create({
      data: {
        applicationId: app.id,
        scheduledAt: done ? daysAgo(1, 15) : inDays(2),
        durationMinutes: 45,
        mode: done ? "IN_PERSON" : "ONLINE",
        location: done ? "TechNova office, 3rd floor, Koramangala" : "https://meet.google.com/demo-interview",
        notes: "Technical round: a short live coding exercise and a chat about your projects.",
        outcome: done ? "PASSED" : "PENDING",
        feedback: done ? "Clear thinking, good React basics. Make an offer." : null,
      },
    });
    interviewCount++;
  }
}

// A hiring test for the internship, taken by its applicants.
const screening = await prisma.quiz.create({
  data: {
    title: "TechNova frontend screening",
    description: "20 minutes, all applicants together. Wrong answers cost a quarter of their points.",
    durationSeconds: 20 * 60,
    isPublished: true,
    negativePercent: 25,
    passPercent: 60,
    jobId: internJob.id,
    createdById: technova.id,
    opensAt: daysAgo(3, 10),
    closesAt: daysAgo(3, 12),
    createdAt: daysAgo(5),
    questions: {
      create: [
        { text: "Which CSS property makes a flex item grow to fill space?", skill: "CSS layout", options: ["flex-grow", "flex-fill", "grow", "width: auto"], correct: 0 },
        { text: "What does Array.prototype.reduce return?", skill: "Arrays", options: ["A new array", "A single value", "A boolean", "Nothing"], correct: 1 },
        { text: "Which HTML element is best for a page's main navigation?", skill: "HTML", options: ["<div>", "<nav>", "<menu>", "<section>"], correct: 1 },
      ].map((q, qi) => ({
        text: q.text,
        points: 2,
        skill: q.skill,
        position: qi,
        options: { create: q.options.map((text, oi) => ({ text, isCorrect: oi === q.correct, position: oi })) },
      })),
    },
  },
  include: { questions: { include: { options: true }, orderBy: { position: "asc" } } },
});
for (const s of fsStudents.slice(0, 4)) {
  const answers = screening.questions.map((q) => {
    const right = rand() < s.skill;
    const option = right ? q.options.find((o) => o.isCorrect)! : q.options.find((o) => !o.isCorrect)!;
    return { questionId: q.id, optionId: option.id, isCorrect: right, points: q.points };
  });
  const raw = answers.reduce((t, a) => t + (a.isCorrect ? a.points : -a.points / 4), 0);
  const startedAt = daysAgo(3, 10);
  const timeTakenMs = between(8, 18) * 60_000;
  await prisma.quizAttempt.create({
    data: {
      quizId: screening.id,
      studentId: s.id,
      status: "SUBMITTED",
      startedAt,
      submittedAt: new Date(startedAt.getTime() + timeTakenMs),
      score: Math.max(0, Math.round(raw * 100) / 100),
      maxScore: screening.questions.length * 2,
      timeTakenMs,
      answers: { create: answers.map(({ questionId, optionId, isCorrect }) => ({ questionId, optionId, isCorrect })) },
    },
  });
  attemptCount++;
}

// ---------- Email log (records only; nothing is sent)

const emails: Prisma.EmailLogCreateManyInput[] = [];
for (const s of students) {
  emails.push({ to: s.email, template: "welcome", status: "SENT", attempts: 1, createdAt: daysAgo(between(30, 50)), sentAt: daysAgo(between(30, 50)) });
  emails.push({ to: s.email, template: "quiz-result", status: "SENT", attempts: 1, createdAt: daysAgo(between(1, 7)), sentAt: daysAgo(between(1, 7)) });
}
emails.push({ to: `rahul.mehta@${DOMAIN}`, template: "lead-follow-up", status: "FAILED", attempts: 5, lastError: "Mailbox unavailable (demo)", createdAt: daysAgo(1) });
for (const p of pipeline) {
  if (!p.student || p.status === "APPLIED") continue;
  emails.push({ to: p.student.email, template: "application-update", status: "SENT", attempts: 1, createdAt: daysAgo(2), sentAt: daysAgo(2) });
  if (p.status === "INTERVIEW" || p.status === "OFFERED") emails.push({ to: p.student.email, template: "interview-scheduled", status: "SENT", attempts: 1, createdAt: daysAgo(2), sentAt: daysAgo(2) });
}
await prisma.emailLog.createMany({ data: emails });

console.log(`✔ Demo data added:
  2 mentors, ${batches.length} courses, ${students.length} students
  ${leadCount} leads (every stage, with notes and timelines)
  ${attendanceCount} attendance marks, ${quizzes.length + 1} quizzes (one practice, one hiring test) with ${attemptCount} attempts and ${practiceCount} practice goes
  ${taskCount} tasks with ${submissionCount} submissions; join codes DEMO-WEB1 (FS-Web) and DEMO-UX24 (UI-UX)
  2 recruiters, ${jobCount} jobs (2 campus drives), ${applicationCount} applications, ${interviewCount} interviews; ${sharing.length} students in the talent pool
  ${paymentCount} payments (paid, failed and not completed), 3 resumes, ${emails.length} email log entries
  Demo accounts sign in with their email (…@${DOMAIN}) and ${process.env.DEMO_PASSWORD ? "the DEMO_PASSWORD you set" : "the local demo password Demo@12345!"}.
  Mentor: ${email("Ananya Rao")}   Student: ${email("Aarav Sharma")}   Recruiter: ${email("Neha Kapoor")}
  Remove it all later with: npm run db:demo -- --remove`);

await prisma.$disconnect();
