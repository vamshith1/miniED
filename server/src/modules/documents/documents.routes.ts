import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.js";
import { limits } from "../../middleware/rate-limit.js";
import { deleteDocument, documentUpload, getDocumentForDownload, listDocuments, saveDocument } from "./documents.service.js";

export const documentsRouter = Router();
documentsRouter.use(requireAuth);

// POST /api/documents  multipart: file=<pdf|docx|doc>, kind=RESUME|OTHER (default RESUME)
documentsRouter.post("/", limits.upload, documentUpload, async (req, res) => {
  const { kind } = z.object({ kind: z.enum(["RESUME", "OTHER"]).default("RESUME") }).parse(req.body ?? {});
  const result = await saveDocument(req.file, kind, req.user!);
  res.status(201).json(result);
});

// GET /api/documents?ownerId=  (default: your own)
documentsRouter.get("/", async (req, res) => {
  const { ownerId } = z.object({ ownerId: z.string().optional() }).parse(req.query);
  res.json({ items: await listDocuments(ownerId ?? req.user!.id, req.user!) });
});

// GET /api/documents/:id/download  sends the file as an attachment
documentsRouter.get("/:id/download", async (req, res) => {
  const doc = await getDocumentForDownload(req.params.id, req.user!);
  res.setHeader("Content-Type", doc.mimeType);
  // attachment = always download, never open inline in our origin.
  // filename* carries non-English names safely (RFC 5987).
  const ascii = doc.originalName.replace(/[^\x20-\x7e]/g, "_");
  res.setHeader("Content-Disposition", `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(doc.originalName)}`);
  res.setHeader("Cache-Control", "private, no-store");
  res.send(doc.data);
});

documentsRouter.delete("/:id", async (req, res) => {
  await deleteDocument(req.params.id, req.user!);
  res.status(204).end();
});
