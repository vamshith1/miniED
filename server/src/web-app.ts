import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import express, { type Express } from "express";
import { env } from "./config/env.js";

/**
 * Serves the built React app (client/dist) from the same server as the API,
 * so the whole site is one service on one address: the session cookie is
 * first-party and there's no CORS to configure. In development Vite serves
 * the app instead, and this does nothing because there's no build.
 */
const SERVER_ROOT = join(import.meta.dirname, "..");
const distDir = isAbsolute(env.CLIENT_DIST) ? env.CLIENT_DIST : join(SERVER_ROOT, env.CLIENT_DIST);
const indexHtml = join(distDir, "index.html");

export function serveWebApp(app: Express) {
  if (!existsSync(indexHtml)) {
    if (env.NODE_ENV === "production") console.warn(`Web app: no build at ${distDir}, serving the API only`);
    return;
  }
  // Files under /assets have a content hash in their name, so they can be cached forever.
  app.use("/assets", express.static(join(distDir, "assets"), { immutable: true, maxAge: "1y", index: false }));
  // A missing asset (e.g. an old file name after a deploy) is a plain 404, never index.html.
  app.use("/assets", (_req, res) => {
    res.status(404).end();
  });
  app.use(express.static(distDir, { index: false, maxAge: "1h" }));
  // Any other page (/leads/123, /reset-password?token=...) is a route inside the
  // React app: send index.html and let the app's router handle it.
  app.use((req, res, next) => {
    if ((req.method !== "GET" && req.method !== "HEAD") || req.path.startsWith("/api")) return next();
    res.setHeader("Cache-Control", "no-cache"); // always pick up a new deploy
    res.sendFile(indexHtml);
  });
  console.log(`Web app: serving ${distDir}`);
}
