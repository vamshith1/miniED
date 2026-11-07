import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import multer from "multer";
import type { DocumentKind } from "@prisma/client";
import { env } from "../../config/env.js";
import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../lib/http-error.js";
import type { AuthUser } from "../../middleware/auth.js";

export const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_OTHER_PER_USER = 10;
const SERVER_ROOT = join(import.meta.dirname, "..", "..", "..");
export const UPLOAD_DIR = isAbsolute(env.UPLOAD_DIR) ? env.UPLOAD_DIR : join(SERVER_ROOT, env.UPLOAD_DIR);

// Kept in memory until it passes every check, so rejected files never touch the disk.
export const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1, fields: 5 },
  defParamCharset: "utf8", // browsers send file names as UTF-8; the default would garble "प्रिया.pdf"
}).single("file");

/**
 * Accepted types, recognised by the file's first bytes. The browser's
 * Content-Type and the file name are easy to fake, so neither is trusted
 * alone: the extension must also match what the bytes say.
 */
const TYPES = [
  { ext: ".pdf", mime: "application/pdf", magic: Buffer.from("%PDF-") },
  {
    ext: ".docx",
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    magic: Buffer.from([0x50, 0x4b, 0x03, 0x04]), // a ZIP file
    // A Word file is a ZIP containing word/document.xml; a plain .zip renamed to .docx isn't.
    check: (b: Buffer) => b.includes("word/"),
  },
  { ext: ".doc", mime: "application/msword", magic: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]) },
];

function detectType(file: Express.Multer.File) {
  const name = file.originalname.toLowerCase();
  const type = TYPES.find((t) => name.endsWith(t.ext));
  if (!type) throw new HttpError(400, "Only PDF and Word files (.pdf, .docx, .doc) are accepted");
  const bytesMatch = file.buffer.subarray(0, type.magic.length).equals(type.magic) && (!type.check || type.check(file.buffer));
  if (!bytesMatch) throw new HttpError(400, `This file isn't a real ${type.ext} file`);
  return type;
}

// Keeps the name readable but harmless: no folders, control characters or very long names.
function cleanName(original: string) {
  const base = original.split(/[\\/]/).pop() ?? "file";
  const cleaned = base.replace(/[\u0000-\u001f\u007f"<>|:*?]/g, "").trim();
  return (cleaned || "file").slice(-200);
}

const documentSelect = {
  id: true,
  kind: true,
  originalName: true,
  mimeType: true,
  sizeBytes: true,
  createdAt: true,
  ownerId: true,
} as const;

/**
 * Who may see a user's documents: the owner, any admin, and the mentor
 * of the owner's batch. Everyone else gets 404, the same as for batches.
 */
async function assertCanView(ownerId: string, user: AuthUser) {
  if (user.role === "ADMIN" || ownerId === user.id) return;
  if (user.role === "MENTOR") {
    const owner = await prisma.user.findUnique({ where: { id: ownerId }, select: { batch: { select: { mentorId: true } } } });
    if (owner?.batch?.mentorId === user.id) return;
  }
  throw new HttpError(404, "Document not found");
}

/** Saves an upload for the current user. A new resume replaces the previous one. */
export async function saveDocument(file: Express.Multer.File | undefined, kind: DocumentKind, user: AuthUser) {
  if (!file) throw new HttpError(400, 'Attach the file in a form field named "file"');
  if (file.size === 0) throw new HttpError(400, "The file is empty");
  const type = detectType(file);

  if (kind === "OTHER") {
    const count = await prisma.document.count({ where: { ownerId: user.id, kind: "OTHER" } });
    if (count >= MAX_OTHER_PER_USER) throw new HttpError(409, `You can keep up to ${MAX_OTHER_PER_USER} other documents. Delete one first.`);
  }

  // Random name on disk, never the user's: no path tricks, no clashes, nothing to guess.
  const storedName = `${randomUUID()}${type.ext}`;
  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(join(UPLOAD_DIR, storedName), file.buffer);

  try {
    const previous = kind === "RESUME" ? await prisma.document.findMany({ where: { ownerId: user.id, kind: "RESUME" } }) : [];
    const document = await prisma.$transaction(async (tx) => {
      if (previous.length) await tx.document.deleteMany({ where: { id: { in: previous.map((p) => p.id) } } });
      return tx.document.create({
        data: { kind, originalName: cleanName(file.originalname), storedName, mimeType: type.mime, sizeBytes: file.size, ownerId: user.id },
        select: documentSelect,
      });
    });
    await Promise.all(previous.map((p) => removeFile(p.storedName)));
    return { document, replaced: previous.length > 0 };
  } catch (err) {
    await removeFile(storedName); // the row wasn't saved, so don't leave the file behind
    throw err;
  }
}

async function removeFile(storedName: string) {
  await unlink(join(UPLOAD_DIR, storedName)).catch((err) => {
    if (err.code !== "ENOENT") console.error("Could not delete upload", storedName, err);
  });
}

export async function listDocuments(ownerId: string, user: AuthUser) {
  await assertCanView(ownerId, user);
  return prisma.document.findMany({ where: { ownerId }, orderBy: { createdAt: "desc" }, select: documentSelect });
}

export async function getDocumentForDownload(id: string, user: AuthUser) {
  const doc = await prisma.document.findUnique({ where: { id } });
  if (!doc) throw new HttpError(404, "Document not found");
  await assertCanView(doc.ownerId, user);
  return { ...doc, path: join(UPLOAD_DIR, doc.storedName) };
}

// The owner or an admin can delete. Mentors can only view.
export async function deleteDocument(id: string, user: AuthUser) {
  const doc = await prisma.document.findUnique({ where: { id } });
  if (!doc) throw new HttpError(404, "Document not found");
  await assertCanView(doc.ownerId, user);
  if (user.role !== "ADMIN" && doc.ownerId !== user.id) throw new HttpError(403, "Only the owner or an admin can delete this");
  await prisma.document.delete({ where: { id } });
  await removeFile(doc.storedName);
}
