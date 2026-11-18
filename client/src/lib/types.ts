// Shapes returned by the API. Dates arrive as ISO strings.

export type Role = "ADMIN" | "MENTOR" | "STUDENT";
export type LeadStage = "NEW" | "CONTACTED" | "INTERESTED" | "ENROLLED" | "LOST";
export type AttendanceStatus = "PRESENT" | "LATE" | "ABSENT";
export type EmailStatus = "QUEUED" | "SENT" | "FAILED";

export const STAGES: LeadStage[] = ["NEW", "CONTACTED", "INTERESTED", "ENROLLED", "LOST"];

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  phone: string | null;
  batchId: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface UserBrief {
  id: string;
  name: string;
  email: string;
}

export interface Lead {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  source: string | null;
  courseInterest: string | null;
  stage: LeadStage;
  nextFollowUpAt: string | null;
  createdAt: string;
  updatedAt: string;
  assignedToId: string | null;
  assignedTo: UserBrief | null;
  createdBy: UserBrief;
  convertedUserId: string | null;
  _count: { notes: number };
}

export interface LeadNote {
  id: string;
  body: string;
  createdAt: string;
  author: UserBrief;
}

export interface LeadActivity {
  id: string;
  type: "CREATED" | "IMPORTED" | "STAGE_CHANGED" | "NOTE_ADDED" | "ASSIGNED" | "CONVERTED" | "REMINDER_SENT" | "PAYMENT_RECEIVED";
  meta: Record<string, unknown> | null;
  createdAt: string;
  actor: { id: string; name: string } | null;
}

export interface Batch {
  id: string;
  name: string;
  course: string;
  startDate: string;
  endDate: string | null;
  feePaise: number | null; // course fee in paise (₹1 = 100); null = no fee
  classMinutes: number | null; // length of one class day; null = not set
  mentorId: string | null;
  mentor: UserBrief | null;
  _count: { students: number };
}

export interface Student {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface AttendanceDay {
  date: string;
  unmarked: number;
  items: { student: UserBrief; status: AttendanceStatus | null }[];
}

export interface AttendanceCounts {
  present: number;
  late: number;
  absent: number;
  total: number;
  percentage: number | null;
}

export interface BatchAttendanceSummary {
  batchId: string;
  averagePercentage: number | null;
  items: (AttendanceCounts & { student: UserBrief })[];
}

export interface MyAttendance extends AttendanceCounts {
  batchId: string | null;
  recent: { date: string; status: AttendanceStatus }[];
}

export interface Option {
  id: string;
  text: string;
  isCorrect?: boolean;
}

export interface Question {
  id: string;
  text: string;
  points: number;
  options: Option[];
}

export interface QuizSummary {
  id: string;
  title: string;
  description: string | null;
  durationSeconds: number;
  isPublished: boolean;
  createdAt: string;
  batch: { id: string; name: string };
  _count: { questions: number; attempts: number };
}

export interface StudentQuiz {
  id: string;
  title: string;
  description: string | null;
  durationSeconds: number;
  createdAt: string;
  _count: { questions: number };
  myAttempt: { status: "IN_PROGRESS" | "SUBMITTED" | "EXPIRED"; score: number; maxScore: number } | null;
}

export interface FullQuiz extends QuizSummary {
  questions: Question[];
  createdBy: { id: string; name: string };
}

export interface Attempt {
  id: string;
  status: "IN_PROGRESS" | "SUBMITTED" | "EXPIRED";
  score: number;
  maxScore: number;
  timeTakenMs: number | null;
  startedAt: string;
  submittedAt: string | null;
  student: UserBrief;
}

export interface StartedAttempt {
  attemptId: string;
  startedAt: string;
  expiresAt: string;
  quiz: { id: string; title: string; description: string | null; durationSeconds: number };
  questions: Question[];
}

export interface QuizResult {
  status: "SUBMITTED" | "EXPIRED";
  score: number;
  maxScore: number;
  percentage: number;
  timeTakenMs: number | null;
  submittedAt: string | null;
  review: {
    questionId: string;
    text: string;
    points: number;
    options: Required<Option>[];
    yourOptionId: string | null;
    correct: boolean;
  }[];
}

export interface QuizLeaderboard {
  quizId: string;
  title: string;
  generatedAt: string;
  entries: { rank: number; studentId: string; name: string; score: number; maxScore: number; percentage: number; timeTakenMs: number }[];
}

export interface BatchLeaderboard {
  batchId: string;
  batchName: string;
  generatedAt: string;
  entries: {
    rank: number;
    studentId: string;
    name: string;
    totalScore: number;
    maxScore: number;
    percentage: number;
    quizzesTaken: number;
    totalTimeMs: number;
  }[];
}

export interface EmailLog {
  id: string;
  to: string;
  template: "welcome" | "quiz-result" | "lead-follow-up" | "password-reset" | "password-changed";
  status: EmailStatus;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  sentAt: string | null;
}

export interface DocumentInfo {
  id: string;
  kind: "RESUME" | "OTHER";
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  ownerId: string;
}

export interface DashboardStats {
  generatedAt: string;
  leads: {
    total: number;
    byStage: Record<LeadStage, number>;
    bySource: { source: string; count: number }[];
    followUpsDue: number;
    conversionRate: number | null;
    perWeek: { weekStart: string; created: number; converted: number }[];
  };
  students: number;
  mentors: number;
  batches: { total: number; active: number };
  attendance: {
    last30Days: { percentage: number | null; recordsMarked: number };
    byBatch: { batchId: string; name: string; percentage: number | null }[];
  };
  quizzes: {
    published: number;
    attemptsLast30Days: number;
    averageScoreLast30Days: number | null;
    byBatch: { batchId: string; name: string; averageScore: number | null; attempts: number }[];
  };
  emails: { last7Days: { sent: number; queued: number; failed: number } };
  payments?: { last30Days: { collectedPaise: number; paid: number; failed: number; pending: number } };
}

// ---------- Payments

export interface PaymentConfig {
  enabled: boolean;
  provider: "razorpay" | "fake" | null;
  keyId: string | null;
  currency: string;
}

export interface Payment {
  id: string;
  amountPaise: number;
  currency: string;
  status: "CREATED" | "PAID" | "FAILED";
  provider: string;
  gatewayOrderId: string;
  gatewayPaymentId: string | null;
  failureReason: string | null;
  enrollmentError: string | null;
  createdAt: string;
  paidAt: string | null;
  leadId: string;
  lead: { id: string; name: string; email: string; stage: LeadStage };
  batch: { id: string; name: string; course: string };
  createdBy: { id: string; name: string };
}

export interface PaymentSummary {
  currency: string;
  collectedPaise: number;
  paid: number;
  failed: number;
  pending: number;
}

export type PaymentList = Paginated<Payment> & { summary: PaymentSummary };

// What a student sees about their own payments.
export interface MyPayment {
  id: string;
  amountPaise: number;
  currency: string;
  status: Payment["status"];
  gatewayPaymentId: string | null;
  failureReason: string | null;
  createdAt: string;
  paidAt: string | null;
  batch: { name: string; course: string };
  lead: { name: string };
}

export interface CheckoutInfo {
  provider: "razorpay" | "fake";
  keyId: string | null;
  orderId: string;
  amountPaise: number;
  currency: string;
  description: string;
  prefill: { name: string; email: string; contact?: string };
}

export interface CheckoutResult {
  orderId: string;
  gatewayPaymentId: string;
  signature: string;
}

export type Enrollment =
  | { status: "ENROLLED"; studentId: string; welcomeEmail: { id: string; status: string }; temporaryPassword?: string }
  | { status: "NOT_ENROLLED"; reason: string };

export interface VerifyResult {
  payment: Payment;
  enrollment: Enrollment | null; // null when it had already been processed (e.g. by the webhook)
  alreadyProcessed: boolean;
}

// ---------- A student's own progress (/api/progress/...)

export interface QuizHistoryItem {
  attemptId: string;
  quizId: string;
  title: string;
  batchName: string;
  status: "SUBMITTED" | "EXPIRED";
  takenAt: string;
  score: number;
  maxScore: number;
  percentage: number;
  timeTakenMs: number;
  durationSeconds: number;
  rank: number | null;
  outOf: number;
  classAverage: number | null;
}

export interface QuizHistory {
  summary: {
    taken: number;
    averagePercentage: number | null;
    bestPercentage: number | null;
    latestPercentage: number | null;
    firstPlaces: number;
    totalTimeMs: number;
  };
  items: QuizHistoryItem[]; // newest first
}

export type AttendanceMark = "PRESENT" | "LATE" | "ABSENT";

export interface AttendanceHistory {
  batch: { name: string; course: string; startDate: string; endDate: string | null; classMinutes: number | null } | null;
  summary: { marked: number; present: number; late: number; absent: number; percentage: number | null; currentStreak: number; longestStreak: number };
  records: { date: string; status: AttendanceMark; batchName: string }[]; // oldest first
}

export interface TimeSpent {
  classLengthKnown: boolean;
  totals: {
    totalMinutes: number;
    classMinutes: number | null;
    quizMinutes: number;
    daysAttended: number;
    quizzesTaken: number;
    thisWeekMinutes: number;
    averagePerActiveWeekMinutes: number;
  };
  weeks: { weekStart: string; classMinutes: number; quizMinutes: number; daysAttended: number; quizzes: number }[];
}
