import { env } from "./config/env.js";
import { createApp } from "./app.js";
import { prisma } from "./lib/prisma.js";
import { initCache, redis } from "./lib/cache.js";
import { closeQueue, initQueue, startWorker } from "./modules/emails/email.queue.js";

await initCache();
await initQueue();
if (env.RUN_WORKER) await startWorker();

const server = createApp().listen(env.PORT, () => {
  console.log(`MiniEdCRM API running on http://localhost:${env.PORT}`);
});

// Close connections cleanly when Docker or Ctrl+C stops the process.
async function shutdown() {
  server.close();
  await closeQueue();
  await prisma.$disconnect();
  redis?.disconnect();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
