import bcrypt from "bcryptjs";

// 12 rounds takes roughly 200–300ms per hash: slow enough to resist
// brute force, fast enough for normal logins.
const ROUNDS = 12;

export const hashPassword = (plain: string) => bcrypt.hash(plain, ROUNDS);
export const verifyPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

// Compared against when an email doesn't exist, so a login for an unknown
// email takes as long as a wrong password. Otherwise response time would
// reveal which emails are registered.
export const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", ROUNDS);
