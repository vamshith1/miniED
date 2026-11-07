process.env.DATABASE_URL ??= "postgresql://x"; process.env.JWT_SECRET ??= "x".repeat(40);
const { rank } = await import("../../src/modules/quizzes/leaderboard.ts");
const rows = [{ s: 10 }, { s: 8 }, { s: 8 }, { s: 8 }, { s: 5 }, { s: 5 }, { s: 1 }];
const got = rank(rows, (a: any, b: any) => a.s === b.s).map((r: any) => r.rank).join(",");
const ok = got === "1,2,2,2,5,5,7";
console.log(ok ? `PASS  tie ranking ${got}` : `FAIL  tie ranking, got ${got}`);
process.exit(ok ? 0 : 1);
