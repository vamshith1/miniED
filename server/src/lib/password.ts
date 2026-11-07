import bcrypt from "bcryptjs";
import { env } from "../config/env.js";

// Each extra round doubles the time per hash. 12 takes ~0.3–0.7 s on a laptop:
// slow enough to resist brute force, fast enough for normal logins. Small free
// hosts have weak CPUs, so BCRYPT_ROUNDS=10 (4x faster) can be set there.
// Existing hashes keep working when this changes: each stores its own cost.
const ROUNDS = env.BCRYPT_ROUNDS;

export const hashPassword = (plain: string) => bcrypt.hash(plain, ROUNDS);
export const verifyPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

// Compared against when an email doesn't exist, so a login for an unknown
// email takes as long as a wrong password. Otherwise response time would
// reveal which emails are registered.
export const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", ROUNDS);
