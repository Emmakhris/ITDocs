/**
 * Identifies an uploaded file from its first bytes rather than trusting its name or the
 * browser-supplied type. Used for diagrams, where images are shown in the page.
 */
export type SniffedType = { mime: string; kind: "image" | "pdf" | "svg" | "drawio" | "visio" | "other"; ext: string };

const starts = (b: Uint8Array, sig: number[], at = 0) => sig.every((x, i) => b[at + i] === x);

export function sniffFile(bytes: Uint8Array, fileName = ""): SniffedType {
  if (starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: "image/png", kind: "image", ext: "png" };
  if (starts(bytes, [0xff, 0xd8, 0xff])) return { mime: "image/jpeg", kind: "image", ext: "jpg" };
  if (starts(bytes, [0x47, 0x49, 0x46, 0x38])) return { mime: "image/gif", kind: "image", ext: "gif" };
  if (starts(bytes, [0x52, 0x49, 0x46, 0x46]) && starts(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return { mime: "image/webp", kind: "image", ext: "webp" };
  if (starts(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return { mime: "application/pdf", kind: "pdf", ext: "pdf" };
  const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, 2048)).replace(/^﻿/, "").trimStart();
  if (/^<mxfile[\s>]/i.test(head) || (/^<\?xml/i.test(head) && /<mxfile[\s>]/i.test(head))) return { mime: "application/vnd.jgraph.mxfile", kind: "drawio", ext: "drawio" };
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head)) return { mime: "image/svg+xml", kind: "svg", ext: "svg" };
  if (starts(bytes, [0x50, 0x4b, 0x03, 0x04]) && /\.vsdx$/i.test(fileName)) return { mime: "application/vnd.ms-visio.drawing", kind: "visio", ext: "vsdx" };
  return { mime: "application/octet-stream", kind: "other", ext: "bin" };
}

/** Types accepted as diagrams. */
export const DIAGRAM_KINDS: SniffedType["kind"][] = ["image", "pdf", "svg", "drawio", "visio"];
