// Runs the email worker on its own, without the HTTP API.
// Usage: npm run worker   (then start the API with RUN_WORKER=false)
// Useful in production, so slow email sending never competes with API requests.
import "./config/env.js";
import { prisma } from "./lib/prisma.js";
import { initCache, redis } from "./lib/cache.js";
import { closeQueue, initQueue, startWorker } from "./modules/emails/email.queue.js";

await initCache();
await initQueue();
await startWorker();

async function shutdown() {
  await closeQueue(); // lets the job in progress finish first
  await prisma.$disconnect();
  redis?.disconnect();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
