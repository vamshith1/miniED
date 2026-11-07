import express from "express";
import cors from "cors";
import helmet from "helmet";
import { env } from "./config/env.js";
import { healthRouter } from "./routes/health.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { usersRouter } from "./modules/users/users.routes.js";
import { leadsRouter } from "./modules/leads/leads.routes.js";
import { batchesRouter } from "./modules/batches/batches.routes.js";
import { attendanceRouter } from "./modules/attendance/attendance.routes.js";
import { quizzesRouter } from "./modules/quizzes/quizzes.routes.js";
import { errorHandler, notFound } from "./middleware/error.js";

// The app is built separately from index.ts so tests can import it
// without starting a real server.
export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: env.CLIENT_URL, credentials: true }));
  app.use(express.json({ limit: "1mb" }));

  app.use("/api/health", healthRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/leads", leadsRouter);
  app.use("/api/batches", batchesRouter);
  app.use("/api/attendance", attendanceRouter);
  app.use("/api/quizzes", quizzesRouter);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
