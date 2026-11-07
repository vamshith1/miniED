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
        <Route path="batches" element={<RequireRole roles={managers}><BatchesPage /></RequireRole>} />
        <Route path="batches/:id" element={<RequireRole roles={managers}><BatchDetailPage /></RequireRole>} />
        <Route path="quizzes/new" element={<RequireRole roles={managers}><QuizEditorPage /></RequireRole>} />
        <Route path="quizzes/:id" element={<RequireRole roles={managers}><QuizEditorPage /></RequireRole>} />
        <Route path="home" element={<RequireRole roles={student}><StudentHomePage /></RequireRole>} />
        <Route path="quizzes/:id/take" element={<RequireRole roles={student}><TakeQuizPage /></RequireRole>} />
        <Route path="quizzes/:id/result" element={<RequireRole roles={student}><QuizResultPage /></RequireRole>} />
        <Route path="documents" element={<DocumentsPage />} />
        <Route path="account" element={<AccountPage />} />
        <Route path="*" element={<Home />} />
      </Route>
    </Routes>
  );
}
