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
import { emailsRouter } from "./modules/emails/emails.routes.js";
import { dashboardRouter } from "./modules/dashboard/dashboard.routes.js";
import { documentsRouter } from "./modules/documents/documents.routes.js";
import { errorHandler, notFound } from "./middleware/error.js";
import { limits } from "./middleware/rate-limit.js";
import { serveWebApp } from "./web-app.js";
import { cronRouter } from "./routes/cron.js";
import { paymentsRouter, paymentsWebhookRouter } from "./modules/payments/payments.routes.js";
import { progressRouter } from "./modules/progress/progress.routes.js";

// Helmet's default Content Security Policy, plus Razorpay's checkout when it's in use
// (its script, its payment iframe and the calls it makes).
function contentSecurityPolicy() {
  const d = helmet.contentSecurityPolicy.getDefaultDirectives();
  if (env.PAYMENT_PROVIDER !== "razorpay") return d;
  const add = (name: string, ...sources: string[]) => {
    d[name] = [...((d[name] as string[] | undefined) ?? ["'self'"]), ...sources];
  };
  add("script-src", "https://checkout.razorpay.com");
  add("frame-src", "https://api.razorpay.com", "https://checkout.razorpay.com");
  add("connect-src", "https://api.razorpay.com", "https://lumberjack.razorpay.com");
  add("img-src", "https://*.razorpay.com");
  return d;
}

// The app is built separately from index.ts so tests can import it
// without starting a real server.
export function createApp() {
  const app = express();
  // Behind Render/Caddy, req.ip comes from X-Forwarded-For only if we trust that many proxies.
  app.set("trust proxy", env.TRUST_PROXY);

  app.use(helmet({ contentSecurityPolicy: { directives: contentSecurityPolicy() } }));
  app.use(cors({ origin: env.CLIENT_URL, credentials: true }));
  // The gateway's webhook is verified over its exact bytes, so it reads the raw body: mounted before express.json.
  app.use("/api/payments/webhook", limits.api, paymentsWebhookRouter);
  app.use(express.json({ limit: "1mb" }));

  app.use("/api/health", healthRouter); // not rate limited: uptime checks call it often
  app.use("/api", limits.api);
  app.use("/api/auth", authRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/leads", leadsRouter);
  app.use("/api/batches", batchesRouter);
  app.use("/api/attendance", attendanceRouter);
  app.use("/api/quizzes", quizzesRouter);
  app.use("/api/emails", emailsRouter);
  app.use("/api/dashboard", dashboardRouter);
  app.use("/api/documents", documentsRouter);
  app.use("/api/cron", cronRouter);
  app.use("/api/payments", paymentsRouter);
  app.use("/api/progress", progressRouter);

  serveWebApp(app); // the React app, when it has been built (production)

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
