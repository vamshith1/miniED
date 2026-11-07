import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError, z } from "zod";
import { MulterError } from "multer";
import { HttpError } from "../lib/http-error.js";

export const notFound: RequestHandler = (req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
};

// Every error in the app ends up here, so responses always share one shape:
// { error: string, details?: unknown }
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({ error: "Validation failed", details: z.flattenError(err).fieldErrors });
    return;
  }
  if (err instanceof MulterError) {
    const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    res.status(status).json({ error: err.code === "LIMIT_FILE_SIZE" ? "File is too large" : err.message });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, details: err.details });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
};
