import { useEffect } from "react";

/**
 * A copy of unsaved form work kept in this browser, so a reload, a crash or a
 * closed tab doesn't lose it. Only a safety net: the server copy is the real one.
 * Storage can be unavailable (private windows, blocked site data), so every
 * access is wrapped and simply does nothing then.
 */
const PREFIX = "mecrm:draft:";

export type Backup<T> = { draft: T; savedAt: string };

export function readBackup<T>(key: string): Backup<T> | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as Backup<T>) : null;
  } catch {
    return null;
  }
}

export function writeBackup<T>(key: string, draft: T) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ draft, savedAt: new Date().toISOString() }));
  } catch {
    /* storage full or blocked: nothing we can do */
  }
}

export function clearBackup(key: string) {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}

/** On sign-out, so the next person on a shared computer doesn't see someone's drafts. */
export function clearAllBackups() {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(PREFIX))
      .forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}

/** Asks the browser to confirm before closing or reloading the tab while `when` is true. */
export function useLeaveWarning(when: boolean) {
  useEffect(() => {
    if (!when) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = ""; // older browsers need this to show the prompt
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [when]);
}
