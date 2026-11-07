import { PrismaClient } from "@prisma/client";

// One shared client for the whole app. Creating a client per request
// would open a new connection pool each time.
export const prisma = new PrismaClient();
