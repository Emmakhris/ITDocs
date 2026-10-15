import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { AppError, FieldError } from "./errors";

// File storage for attachments (KB articles, contract documents). Files live under UPLOAD_DIR,
// named by a random key — never by the uploader's file name — and are only served through
// /api/files/[id], which checks the reader may see the record the file belongs to.

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const AREAS = ["kb", "contracts"] as const;
export type StorageArea = (typeof AREAS)[number];

const uploadRoot = () => path.resolve(process.env.UPLOAD_DIR || "./data/uploads");

function filePath(storageKey: string) {
  const [area, name, ...rest] = storageKey.split("/");
  if (rest.length || !AREAS.includes(area as StorageArea) || !/^[a-f0-9]{32}$/.test(name ?? "")) throw new AppError("Invalid storage key.");
  return path.join(uploadRoot(), area, name);
}

export const safeFileName = (name: string) =>
  (name.split(/[\\/]/).pop() ?? "file").replace(/[\u0000-\u001f"<>:|?*]/g, "_").replace(/^\.+/, "").slice(0, 150) || "file";

/** Validates and writes an uploaded file; returns the Attachment fields to store. */
export async function storeFile(area: StorageArea, file: File | null | undefined) {
  if (!file || typeof file === "string" || !file.size) throw new FieldError({ file: "Choose a file" });
  if (file.size > MAX_ATTACHMENT_BYTES) throw new FieldError({ file: "Files can be at most 10 MB" });
  const storageKey = `${area}/${crypto.randomBytes(16).toString("hex")}`;
  const dest = filePath(storageKey);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, Buffer.from(await file.arrayBuffer()), { flag: "wx" });
  return { storageKey, fileName: safeFileName(file.name), mimeType: (file.type || "application/octet-stream").slice(0, 100), size: file.size };
}

export const readStoredFile = (storageKey: string) => fs.readFile(filePath(storageKey));
export const removeStoredFile = (storageKey: string) => fs.rm(filePath(storageKey), { force: true });
