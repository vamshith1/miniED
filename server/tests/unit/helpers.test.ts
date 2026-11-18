import { describe, expect, it } from "vitest";
import { rank } from "../../src/modules/quizzes/leaderboard.js";
import { paginated, paginationQuery, toSkipTake } from "../../src/lib/pagination.js";
import { dateOnly, fromDbDate, toDbDate } from "../../src/lib/dates.js";
import { open, seal } from "../../src/lib/secret-box.js";
import { signToken, verifyToken } from "../../src/lib/jwt.js";
import { password } from "../../src/modules/auth/auth.schemas.js";

describe("rank (competition ranking)", () => {
  it("gives equal rows the same rank and skips the next ones", () => {
    const rows = [10, 8, 8, 8, 5, 5, 1].map((s) => ({ s }));
    expect(rank(rows, (a, b) => a.s === b.s).map((r) => r.rank)).toEqual([1, 2, 2, 2, 5, 5, 7]);
  });

  it("handles an empty list", () => {
    expect(rank([], () => true)).toEqual([]);
  });
});

describe("pagination", () => {
  it("defaults to page 1, 20 per page", () => {
    expect(paginationQuery.parse({})).toEqual({ page: 1, limit: 20 });
  });

  it("rejects a limit over 100 and a page under 1", () => {
    expect(paginationQuery.safeParse({ limit: "101" }).success).toBe(false);
    expect(paginationQuery.safeParse({ page: "0" }).success).toBe(false);
  });

  it("turns page/limit into skip/take and counts pages", () => {
    expect(toSkipTake({ page: 3, limit: 10 })).toEqual({ skip: 20, take: 10 });
    expect(paginated(["a"], 21, { page: 3, limit: 10 }).totalPages).toBe(3);
  });
});

describe("date-only values", () => {
  it("round-trips YYYY-MM-DD without shifting a day", () => {
    expect(fromDbDate(toDbDate("2026-03-01"))).toBe("2026-03-01");
  });

  it("rejects other formats", () => {
    expect(dateOnly.safeParse("01/03/2026").success).toBe(false);
    expect(dateOnly.safeParse("2026-02-30").success).toBe(false);
  });
});

describe("secret box", () => {
  it("decrypts what it encrypts, with a different output each time", () => {
    const a = seal("Temp#Pass123");
    expect(a).not.toContain("Temp#Pass123");
    expect(seal("Temp#Pass123")).not.toBe(a);
    expect(open(a)).toBe("Temp#Pass123");
  });

  it("refuses a tampered value", () => {
    const [iv, tag, data] = seal("secret").split(".");
    const flipped = data[0] === "A" ? `B${data.slice(1)}` : `A${data.slice(1)}`;
    expect(() => open([iv, tag, flipped].join("."))).toThrow();
  });
});

describe("JWT", () => {
  it("verifies its own tokens and rejects edited ones", () => {
    const token = signToken({ sub: "u1", role: "ADMIN", v: 2 });
    expect(verifyToken(token)).toMatchObject({ sub: "u1", role: "ADMIN", v: 2 });
    expect(() => verifyToken(token.slice(0, -2) + "xx")).toThrow();
  });
});

describe("password rules", () => {
  it("needs 8 to 72 characters", () => {
    expect(password.safeParse("short").success).toBe(false);
    expect(password.safeParse("long enough").success).toBe(true);
    expect(password.safeParse("x".repeat(73)).success).toBe(false);
  });
});
