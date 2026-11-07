// Creates the starting accounts. Safe to run more than once (it upserts).
// Usage: npm run db:seed
import "dotenv/config";
import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const accounts = [
  {
    name: "Institute Admin",
    email: process.env.SEED_ADMIN_EMAIL ?? "admin@miniedcrm.test",
    password: process.env.SEED_ADMIN_PASSWORD ?? "Admin@12345",
    role: Role.ADMIN,
  },
  {
    name: "Demo Mentor",
    email: process.env.SEED_MENTOR_EMAIL ?? "mentor@miniedcrm.test",
    password: process.env.SEED_MENTOR_PASSWORD ?? "Mentor@12345",
    role: Role.MENTOR,
  },
];

for (const a of accounts) {
  const passwordHash = await bcrypt.hash(a.password, 12);
  await prisma.user.upsert({
    where: { email: a.email },
    update: {},
    create: { name: a.name, email: a.email, role: a.role, passwordHash },
  });
  console.log(`✔ ${a.role.padEnd(7)} ${a.email}`);
}

await prisma.$disconnect();
