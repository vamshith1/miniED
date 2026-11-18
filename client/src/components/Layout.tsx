import { useState, type ReactNode } from "react";
import { NavLink, Outlet } from "react-router";
import { BookOpen, CircleUser, FileText, Gauge, GraduationCap, Home, LogOut, Mail, Menu, Users, UserRoundSearch, X } from "lucide-react";
import { useAuth, useUser } from "../lib/auth";
import type { Role } from "../lib/types";
import { titleCase } from "../lib/format";
import { cx } from "./ui";

const NAV: Record<Role, { to: string; label: string; icon: ReactNode }[]> = {
  ADMIN: [
    { to: "/dashboard", label: "Dashboard", icon: <Gauge className="size-4" /> },
    { to: "/leads", label: "Leads", icon: <UserRoundSearch className="size-4" /> },
    { to: "/batches", label: "Batches", icon: <GraduationCap className="size-4" /> },
    { to: "/users", label: "Users", icon: <Users className="size-4" /> },
    { to: "/emails", label: "Emails", icon: <Mail className="size-4" /> },
  ],
  MENTOR: [
    { to: "/batches", label: "My batches", icon: <GraduationCap className="size-4" /> },
    { to: "/documents", label: "My documents", icon: <FileText className="size-4" /> },
  ],
  STUDENT: [
    { to: "/home", label: "Home", icon: <Home className="size-4" /> },
    { to: "/documents", label: "My resume", icon: <FileText className="size-4" /> },
  ],
};

export function Layout() {
  const user = useUser();
  const { logout } = useAuth();
  const [open, setOpen] = useState(false);

  const nav = (
    <nav className="space-y-0.5" aria-label="Main">
      {NAV[user.role].map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          onClick={() => setOpen(false)}
          className={({ isActive }) =>
            cx(
              "group relative flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-all duration-150",
              isActive
                ? "bg-brand-soft text-brand-strong before:absolute before:inset-y-1.5 before:left-0 before:w-1 before:rounded-full before:bg-brand"
                : "text-muted hover:translate-x-0.5 hover:bg-brand-soft/60 hover:text-brand-strong",
            )
          }
        >
          {item.icon}
          {item.label}
        </NavLink>
      ))}
    </nav>
  );

  const account = (
    <div className="border-t border-line pt-3">
      <p className="truncate px-3 text-sm font-medium text-ink">{user.name}</p>
      <p className="truncate px-3 text-xs text-faint">
        {titleCase(user.role)} · {user.email}
      </p>
      <NavLink
        to="/account"
        onClick={() => setOpen(false)}
        className={({ isActive }) =>
          cx("mt-2 flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm", isActive ? "bg-brand-soft text-brand-strong" : "text-muted hover:bg-canvas hover:text-ink")
        }
      >
        <CircleUser className="size-4" /> Account
      </NavLink>
      <button onClick={logout} className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted hover:bg-canvas hover:text-ink">
        <LogOut className="size-4" /> Sign out
      </button>
    </div>
  );

  const brand = (
    <div className="flex items-center gap-2 px-3">
      <span className="grid size-7 place-items-center rounded-md bg-linear-to-br from-brand to-brand-strong text-white shadow-sm shadow-brand/30">
        <BookOpen className="size-4" />
      </span>
      <span className="font-semibold text-ink">MiniEdCRM</span>
    </div>
  );

  return (
    <div className="min-h-screen md:flex">
      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col justify-between border-r border-line bg-surface px-3 py-4 md:sticky md:top-0 md:flex md:h-screen">
        <div className="space-y-5">
          {brand}
          {nav}
        </div>
        {account}
      </aside>

      {/* Mobile top bar + drawer */}
      <header className="sticky top-0 z-20 flex items-center gap-1 border-b border-line bg-surface/90 px-2 py-2.5 backdrop-blur md:hidden">
        <button
          onClick={() => setOpen(true)}
          className="rounded-md p-1.5 text-muted transition-colors hover:bg-brand-soft hover:text-brand-strong active:scale-95"
          aria-label="Open menu"
        >
          <Menu className="size-5" />
        </button>
        {brand}
      </header>
      {open && (
        <div className="fixed inset-0 z-30 md:hidden">
          <div className="animate-fade-in absolute inset-0 bg-ink/40" onClick={() => setOpen(false)} />
          <div className="animate-slide-in-left absolute inset-y-0 left-0 flex w-64 flex-col justify-between bg-surface px-3 py-4 shadow-xl">
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                {brand}
                <button onClick={() => setOpen(false)} className="rounded p-1 text-muted hover:bg-canvas" aria-label="Close menu">
                  <X className="size-5" />
                </button>
              </div>
              {nav}
            </div>
            {account}
          </div>
        </div>
      )}

      <main className="min-w-0 flex-1 px-4 py-6 md:px-8">
        <div className="mx-auto max-w-6xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
