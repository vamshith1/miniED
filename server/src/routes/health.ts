import { Router } from "express";
import { prisma } from "../lib/prisma.js";

export const healthRouter = Router();

// Used by Docker and the deploy pipeline to check the app is alive
// and can reach the database.
healthRouter.get("/", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok", db: "up" });
  } catch {
    res.status(503).json({ status: "degraded", db: "down" });
  }
});
