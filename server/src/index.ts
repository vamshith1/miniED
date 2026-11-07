import { env } from "./config/env.js";
import { createApp } from "./app.js";
import { prisma } from "./lib/prisma.js";

const server = createApp().listen(env.PORT, () => {
  console.log(`MiniEdCRM API running on http://localhost:${env.PORT}`);
});

// Close connections cleanly when Docker or Ctrl+C stops the process.
async function shutdown() {
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
