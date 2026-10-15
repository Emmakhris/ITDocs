import { describe, expect, it } from "vitest";
import { validateCustomFields, fieldDefsSchema, type FieldDef } from "@/server/lib/custom-fields";
import { escapeFilter } from "@/server/auth/ldap";
import { csvCell } from "@/server/lib/csv";
import { can } from "@/server/rbac/permissions";
import { diff } from "@/server/audit/log";

describe("custom fields", () => {
  const defs: FieldDef[] = [
    { key: "ram_gb", label: "RAM", kind: "number", required: true },
    { key: "encrypted", label: "Encrypted", kind: "boolean", required: false },
    { key: "policy", label: "Policy", kind: "select", required: false, options: ["Daily", "Hourly"] },
    { key: "portal", label: "Portal", kind: "url", required: false },
  ];

  it("coerces and validates values", () => {
    const r = validateCustomFields(defs, { ram_gb: "16", encrypted: "on", policy: "Daily", junk: "x" });
    expect(r.errors).toEqual({});
    expect(r.values).toEqual({ ram_gb: 16, encrypted: true, policy: "Daily" });
  });

  it("reports required, bad number, bad option and non-http urls", () => {
    expect(validateCustomFields(defs, {}).errors.ram_gb).toMatch(/required/);
    const r = validateCustomFields(defs, { ram_gb: "lots", policy: "Weekly", portal: "javascript:alert(1)" });
    expect(Object.keys(r.errors).sort()).toEqual(["policy", "portal", "ram_gb"]);
  });

  it("rejects duplicate keys and bad key formats", () => {
    expect(fieldDefsSchema.safeParse([defs[0], defs[0]]).success).toBe(false);
    expect(fieldDefsSchema.safeParse([{ ...defs[0], key: "Bad Key" }]).success).toBe(false);
  });
});

describe("security helpers", () => {
  it("escapes LDAP filter metacharacters", () => {
    expect(escapeFilter("*)(uid=*")).toBe("\\2a\\29\\28uid=\\2a");
    expect(escapeFilter("a\\b")).toBe("a\\5cb");
  });

  it("neutralises CSV formula injection and quotes", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell(null)).toBe("");
  });
});

describe("RBAC matrix", () => {
  it("applies role defaults", () => {
    expect(can("ADMIN", "admin", "write")).toBe(true);
    expect(can("TECHNICIAN", "assets", "write")).toBe(true);
    expect(can("TECHNICIAN", "admin", "read")).toBe(false);
    expect(can("READONLY", "assets", "write")).toBe(false);
    expect(can("READONLY", "vault", "read")).toBe(false);
    expect(can("AUDITOR", "audit", "read")).toBe(true);
    expect(can("AUDITOR", "assets", "write")).toBe(false);
  });
});

describe("audit diff", () => {
  it("returns only changed keys", () => {
    const d = diff({ a: 1, b: "x", updatedAt: 1 }, { a: 2, b: "x", updatedAt: 2 });
    expect(d.changed).toEqual(["a"]);
    expect(d.before).toEqual({ a: 1 });
  });
});
