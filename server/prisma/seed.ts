// Creates the starting accounts. Safe to run more than once (it upserts).
// Usage: npm run db:seed
//
// On your own machine it falls back to the example accounts from .env.example.
// Against any other database (e.g. Neon in production) those public example
// passwords would be a security hole, so there it requires SEED_ADMIN_EMAIL and
// SEED_ADMIN_PASSWORD, and only creates the demo mentor if SEED_MENTOR_* are set.
import "dotenv/config";
import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";

const EXAMPLE_PASSWORDS = ["Admin@12345", "Mentor@12345"];
const host = (() => {
  try {
    return new URL(process.env.DATABASE_URL ?? "").hostname;
  } catch {
    return "";
  }
})();
const isLocal = ["localhost", "127.0.0.1", "::1", "postgres"].includes(host); // "postgres" = the Docker Compose service

function fail(message: string): never {
  console.error(`Seed stopped: ${message}`);
  process.exit(1);
}

const env = process.env;
if (!isLocal) {
  if (!env.SEED_ADMIN_EMAIL || !env.SEED_ADMIN_PASSWORD) fail(`database ${host} isn't local, so set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD.`);
  const passwords = [env.SEED_ADMIN_PASSWORD, env.SEED_MENTOR_PASSWORD].filter(Boolean) as string[];
  if (passwords.some((p) => EXAMPLE_PASSWORDS.includes(p) || p.length < 10)) {
    fail("use real passwords (10+ characters, not the examples from .env.example) for a non-local database.");
  }
}

const accounts = [
  {
    name: "Institute Admin",
    email: env.SEED_ADMIN_EMAIL ?? "admin@miniedcrm.test",
    password: env.SEED_ADMIN_PASSWORD ?? "Admin@12345",
    role: Role.ADMIN,
  },
  // The demo mentor: always locally, elsewhere only when asked for.
  ...(isLocal || (env.SEED_MENTOR_EMAIL && env.SEED_MENTOR_PASSWORD)
    ? [
        {
          name: "Demo Mentor",
          email: env.SEED_MENTOR_EMAIL ?? "mentor@miniedcrm.test",
          password: env.SEED_MENTOR_PASSWORD ?? "Mentor@12345",
          role: Role.MENTOR,
        },
      ]
    : []),
];

const prisma = new PrismaClient();
for (const a of accounts) {
  const passwordHash = await bcrypt.hash(a.password, 12);
  await prisma.user.upsert({
    where: { email: a.email.trim().toLowerCase() },
    update: {},
    create: { name: a.name, email: a.email.trim().toLowerCase(), role: a.role, passwordHash },
  });
  console.log(`✔ ${a.role.padEnd(7)} ${a.email}`);
}
await prisma.$disconnect();
