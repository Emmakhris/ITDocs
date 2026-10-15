import { z } from "zod";

export const FIELD_KINDS = ["text", "textarea", "number", "date", "select", "boolean", "url"] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

export const fieldDefSchema = z.object({
  key: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{0,39}$/, "Key must be lowercase letters, digits or _ and start with a letter"),
  label: z.string().trim().min(1).max(80),
  kind: z.enum(FIELD_KINDS),
  required: z.boolean().default(false),
  options: z.array(z.string().trim().min(1)).optional(), // for select
  help: z.string().max(200).optional(),
});
export type FieldDef = z.infer<typeof fieldDefSchema>;

export const fieldDefsSchema = z
  .array(fieldDefSchema)
  .max(60)
  .refine((defs) => new Set(defs.map((d) => d.key)).size === defs.length, "Field keys must be unique");

export function parseFieldDefs(raw: unknown): FieldDef[] {
  const r = fieldDefsSchema.safeParse(raw);
  return r.success ? r.data : [];
}

/**
 * Validate and coerce submitted custom field values (strings from forms or JSON from the API)
 * against the type's definitions. Unknown keys are dropped.
 */
export function validateCustomFields(defs: FieldDef[], input: Record<string, unknown>) {
  const out: Record<string, string | number | boolean | null> = {};
  const errors: Record<string, string> = {};
  for (const d of defs) {
    const raw = input[d.key];
    const empty = raw === undefined || raw === null || raw === "";
    if (empty) {
      if (d.required && d.kind !== "boolean") errors[d.key] = `${d.label} is required`;
      if (d.kind === "boolean") out[d.key] = false;
      continue;
    }
    const s = String(raw).trim();
    switch (d.kind) {
      case "number": {
        const n = Number(s);
        if (!Number.isFinite(n)) errors[d.key] = `${d.label} must be a number`;
        else out[d.key] = n;
        break;
      }
      case "date":
        if (Number.isNaN(Date.parse(s))) errors[d.key] = `${d.label} must be a date`;
        else out[d.key] = s.slice(0, 10);
        break;
      case "boolean":
        out[d.key] = raw === true || s === "true" || s === "on" || s === "1";
        break;
      case "select":
        if (d.options && !d.options.includes(s)) errors[d.key] = `${d.label}: invalid option`;
        else out[d.key] = s;
        break;
      case "url":
        if (!/^https?:\/\//i.test(s)) errors[d.key] = `${d.label} must start with http(s)://`;
        else out[d.key] = s.slice(0, 2000);
        break;
      default:
        out[d.key] = s.slice(0, d.kind === "textarea" ? 5000 : 500);
    }
  }
  return { values: out, errors };
}
