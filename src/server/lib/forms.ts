import { z, ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { AppError, FieldError } from "./errors";

/** Server action result shape consumed by useActionState forms. */
export type ActionState = {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
  message?: string;
};

/** FormData → plain object. Empty strings become undefined; repeated keys become arrays. */
export function formToObject(fd: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("$ACTION")) continue;
    const val = typeof v === "string" ? (v.trim() === "" ? undefined : v.trim()) : v;
    if (k in out) {
      const prev = out[k];
      out[k] = Array.isArray(prev) ? [...prev, val] : [prev, val];
    } else out[k] = val;
  }
  return out;
}

/** Convert thrown errors to an ActionState (rethrows Next.js redirect/notFound signals). */
export function toActionError(e: unknown): ActionState {
  if (e instanceof ZodError) {
    const fieldErrors: Record<string, string> = {};
    for (const i of e.issues) fieldErrors[i.path.join(".") || "_"] ??= i.message;
    return { error: "Please fix the highlighted fields.", fieldErrors };
  }
  if (e instanceof FieldError) return { error: e.message, fieldErrors: e.fieldErrors };
  if (e instanceof AppError) return { error: e.message };
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    const target = ([] as string[]).concat((e.meta?.target as string[] | string) ?? []).join(", ");
    return { error: `That ${target || "value"} is already in use.` };
  }
  const digest = (e as { digest?: string })?.digest;
  if (typeof digest === "string" && digest.startsWith("NEXT_")) throw e;
  console.error(e);
  return { error: "Something went wrong. The error has been logged." };
}

// Common zod helpers for form input
export const optStr = (max = 500) => z.string().trim().max(max).optional();
export const optDate = z
  .union([z.string(), z.date()])
  .optional()
  .transform((v) => (v ? new Date(v) : undefined))
  .refine((d) => !d || !Number.isNaN(d.getTime()), "Invalid date");
export const optNum = z
  .union([z.string(), z.number()])
  .optional()
  .transform((v) => (v === undefined || v === "" ? undefined : Number(v)))
  .refine((n) => n === undefined || Number.isFinite(n), "Must be a number");
export const checkbox = z
  .union([z.string(), z.boolean()])
  .optional()
  .transform((v) => v === true || v === "on" || v === "true");
