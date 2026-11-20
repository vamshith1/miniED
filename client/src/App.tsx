import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router";
import { homePathFor, useAuth } from "./lib/auth";
import type { Role } from "./lib/types";
import { Spinner } from "./components/ui";
import { Layout } from "./components/Layout";
import { LoginPage, SignupPage } from "./pages/Auth";
import { AccountPage, ForgotPasswordPage, ResetPasswordPage } from "./pages/Password";
import { LeadsPage } from "./pages/admin/Leads";
import { LeadDetailPage } from "./pages/admin/LeadDetail";
import { UsersPage } from "./pages/admin/Users";
import { EmailsPage } from "./pages/admin/Emails";
import { BatchesPage } from "./pages/Batches";
import { BatchDetailPage } from "./pages/BatchDetail";
import { QuizEditorPage } from "./pages/QuizEditor";
import { StudentHomePage } from "./pages/student/Home";
import { TakeQuizPage } from "./pages/student/TakeQuiz";
import { QuizResultPage } from "./pages/student/QuizResult";
import { DocumentsPage } from "./pages/Documents";
import { PaymentsPage } from "./pages/admin/Payments";
import { MyPaymentsPage } from "./pages/student/MyPayments";
import { MyQuizzesPage } from "./pages/student/MyQuizzes";
import { MyAttendancePage } from "./pages/student/MyAttendance";
import { TimeSpentPage } from "./pages/student/TimeSpent";
import { PracticeQuizPage } from "./pages/student/PracticeQuiz";
import { MyTasksPage } from "./pages/student/MyTasks";
import { PlacementPage } from "./pages/Placement";
import { JobsPage } from "./pages/jobs/Jobs";
import { JobDetailPage } from "./pages/jobs/JobDetail";
import { TalentPage } from "./pages/jobs/Talent";
import { CareersPage } from "./pages/student/Careers";

// Signed-in pages. Wrong role → your own home page; signed out → login,
// coming back here afterwards (e.g. from a link in an email).
function RequireRole({ roles, children }: { roles?: Role[]; children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to={homePathFor(user.role)} replace />;
  return <>{children}</>;
}

function Home() {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  return <Navigate to={user ? homePathFor(user.role) : "/login"} replace />;
}

// The charts library is large, so only admins opening the dashboard download it.
const DashboardPage = lazy(() => import("./pages/admin/Dashboard").then((m) => ({ default: m.DashboardPage })));

const admin: Role[] = ["ADMIN"];
const managers: Role[] = ["ADMIN", "MENTOR"];
const student: Role[] = ["STUDENT"];
const hiring: Role[] = ["ADMIN", "RECRUITER"];
// Quiz builder: mentors for batch quizzes, recruiters for their jobs' hiring tests.
const builders: Role[] = ["ADMIN", "MENTOR", "RECRUITER"];

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route
        element={
          <RequireRole>
            <Layout />
          </RequireRole>
        }
      >
        <Route index element={<Home />} />
        <Route path="dashboard" element={<RequireRole roles={admin}><Suspense fallback={<Spinner />}><DashboardPage /></Suspense></RequireRole>} />
        <Route path="leads" element={<RequireRole roles={admin}><LeadsPage /></RequireRole>} />
        <Route path="leads/:id" element={<RequireRole roles={admin}><LeadDetailPage /></RequireRole>} />
        <Route path="users" element={<RequireRole roles={admin}><UsersPage /></RequireRole>} />
        <Route path="emails" element={<RequireRole roles={admin}><EmailsPage /></RequireRole>} />
        <Route path="payments" element={<RequireRole roles={admin}><PaymentsPage /></RequireRole>} />
        <Route path="batches" element={<RequireRole roles={managers}><BatchesPage /></RequireRole>} />
        <Route path="placement" element={<RequireRole roles={managers}><PlacementPage /></RequireRole>} />
        <Route path="batches/:id" element={<RequireRole roles={managers}><BatchDetailPage /></RequireRole>} />
        <Route path="quizzes/new" element={<RequireRole roles={builders}><QuizEditorPage /></RequireRole>} />
        <Route path="quizzes/:id" element={<RequireRole roles={builders}><QuizEditorPage /></RequireRole>} />
        <Route path="jobs" element={<RequireRole roles={hiring}><JobsPage /></RequireRole>} />
        <Route path="jobs/:id" element={<RequireRole roles={hiring}><JobDetailPage /></RequireRole>} />
        <Route path="talent" element={<RequireRole roles={hiring}><TalentPage /></RequireRole>} />
        <Route path="careers" element={<RequireRole roles={student}><CareersPage /></RequireRole>} />
        <Route path="home" element={<RequireRole roles={student}><StudentHomePage /></RequireRole>} />
        <Route path="quizzes/:id/take" element={<RequireRole roles={student}><TakeQuizPage /></RequireRole>} />
        <Route path="quizzes/:id/practice" element={<RequireRole roles={student}><PracticeQuizPage /></RequireRole>} />
        <Route path="quizzes/:id/result" element={<RequireRole roles={student}><QuizResultPage /></RequireRole>} />
        <Route path="my-payments" element={<RequireRole roles={student}><MyPaymentsPage /></RequireRole>} />
        <Route path="my-quizzes" element={<RequireRole roles={student}><MyQuizzesPage /></RequireRole>} />
        <Route path="my-attendance" element={<RequireRole roles={student}><MyAttendancePage /></RequireRole>} />
        <Route path="my-tasks" element={<RequireRole roles={student}><MyTasksPage /></RequireRole>} />
        <Route path="time-spent" element={<RequireRole roles={student}><TimeSpentPage /></RequireRole>} />
        <Route path="documents" element={<DocumentsPage />} />
        <Route path="account" element={<AccountPage />} />
        <Route path="*" element={<Home />} />
      </Route>
    </Routes>
  );
}
