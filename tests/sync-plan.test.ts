import { describe, expect, it } from "vitest";
import { normHost, normSerial, planDevices, planPeople, type ExistingDevice, type ExistingPerson } from "@/server/lib/sync-plan";

const person = (o: Partial<ExistingPerson> & { id: string }): ExistingPerson => ({ adGuid: null, name: "x", email: null, employeeId: null, title: null, phone: null, department: null, active: true, ...o });

describe("people plan", () => {
  it("creates, updates, links by employee ID or email, and deactivates", () => {
    const existing = [
      person({ id: "1", adGuid: "g1", name: "Ann Old", email: "ann@x.org", title: "Nurse" }),
      person({ id: "2", name: "Bob Hand", employeeId: "E2" }), // entered by hand → linked by employee ID
      person({ id: "3", name: "Cy Mail", email: "cy@x.org" }), // linked by email
      person({ id: "4", adGuid: "g4", name: "Gone Person" }), // not in directory any more
      person({ id: "5", adGuid: "g5", name: "Dee Back", active: false }), // re-enabled
    ];
    const plan = planPeople(existing, [
      { externalId: "G1", name: "Ann New", email: "ann@x.org", title: null, enabled: true }, // GUID match is case-insensitive; null title kept
      { externalId: "g2", name: "Bob Hand", employeeId: "e2", enabled: true },
      { externalId: "g3", name: "Cy Mail", email: "CY@x.org", department: "ICU", enabled: true },
      { externalId: "g5", name: "Dee Back", enabled: true },
      { externalId: "g6", name: "New Starter", enabled: true },
      { externalId: "g7", name: "Disabled Never Seen", enabled: false },
    ]);
    expect(plan.create.map((c) => c.name)).toEqual(["New Starter"]);
    expect(plan.update.find((u) => u.id === "1")?.changes).toEqual({ name: { from: "Ann Old", to: "Ann New" } });
    expect(plan.update.find((u) => u.id === "2")).toMatchObject({ link: true, changes: { employeeId: { from: "E2", to: "e2" } } });
    expect(plan.update.find((u) => u.id === "3")).toMatchObject({ link: true, changes: { email: { from: "cy@x.org", to: "CY@x.org" }, department: { from: null, to: "ICU" } } });
    expect(plan.deactivate).toEqual([{ id: "4", name: "Gone Person", reason: "no longer in the directory" }]);
    expect(plan.reactivate).toEqual([{ id: "5", name: "Dee Back" }]);
    expect(plan.skippedDisabled).toBe(1);
    expect(plan.guard).toBeUndefined();
  });

  it("deactivates people disabled in the directory", () => {
    const plan = planPeople([person({ id: "1", adGuid: "g1", name: "Leaver" })], [{ externalId: "g1", name: "Leaver", enabled: false }]);
    expect(plan.deactivate).toEqual([{ id: "1", name: "Leaver", reason: "disabled in the directory" }]);
  });

  it("refuses to mass-deactivate when the source looks wrong", () => {
    const existing = Array.from({ length: 20 }, (_, i) => person({ id: String(i), adGuid: `g${i}`, name: `P${i}` }));
    expect(planPeople(existing, existing.slice(0, 10).map((p) => ({ externalId: p.adGuid!, name: p.name, enabled: true }))).guard).toMatch(/deactivate 10 of 20/);
    expect(planPeople(existing, []).guard).toMatch(/returned nobody/);
  });
});

describe("device plan", () => {
  const assets: ExistingDevice[] = [
    { id: "a1", tag: "IT-1", hostname: "PC-001", serial: "ABC123", manufacturer: null, model: null, os: "Windows 10" },
    { id: "a2", tag: "IT-2", hostname: "pc-002.corp.local", serial: null, manufacturer: "Dell", model: "OptiPlex", os: null },
    { id: "a3", tag: "IT-3", hostname: "dup", serial: "SAME", manufacturer: null, model: null, os: null },
    { id: "a4", tag: "IT-4", hostname: "dup", serial: "SAME", manufacturer: null, model: null, os: null },
    { id: "a5", tag: "IT-5", hostname: "linked-old-name", serial: null, manufacturer: null, model: null, os: null },
  ];

  it("normalises serials and hostnames", () => {
    expect(normSerial(" abc 123 ")).toBe("ABC123");
    expect(normSerial("To be filled by O.E.M.")).toBeNull();
    expect(normSerial("0000")).toBeNull();
    expect(normHost("PC-001.corp.local")).toBe("pc-001");
  });

  it("matches by link, serial, then hostname, and only fills or overwrites the right fields", () => {
    const plan = planDevices(assets, new Map([["intune-5", "a5"]]), [
      { externalId: "intune-1", hostname: "PC-001-NEW", serial: "abc123", manufacturer: "HP", model: "EliteBook", os: "Windows 11" },
      { externalId: "intune-2", hostname: "PC-002", serial: "XYZ999", manufacturer: "Lenovo", os: "Windows 11" },
      { externalId: "intune-5", hostname: "renamed-pc" },
      { externalId: "intune-9", hostname: "unknown", serial: "NOPE" },
      { externalId: "intune-dup", serial: "SAME" },
    ], false);
    const m = Object.fromEntries(plan.matched.map((x) => [x.tag, x]));
    expect(m["IT-1"].by).toBe("serial");
    expect(m["IT-1"].changes).toEqual({ hostname: { from: "PC-001", to: "PC-001-NEW" }, os: { from: "Windows 10", to: "Windows 11" }, manufacturer: { from: null, to: "HP" }, model: { from: null, to: "EliteBook" } });
    expect(m["IT-2"].by).toBe("hostname");
    expect(m["IT-2"].changes).toEqual({ hostname: { from: "pc-002.corp.local", to: "PC-002" }, os: { from: null, to: "Windows 11" }, serial: { from: null, to: "XYZ999" } }); // Dell kept
    expect(m["IT-5"]).toMatchObject({ by: "link", changes: { hostname: { from: "linked-old-name", to: "renamed-pc" } } });
    expect(plan.unmatched.map((r) => r.externalId)).toEqual(["intune-9"]);
    expect(plan.ambiguous.map((a) => a.tags)).toEqual([["IT-3", "IT-4"]]);
  });

  it("offers unknown devices for creation when asked, and never matches one asset twice", () => {
    const plan = planDevices(assets, new Map(), [{ externalId: "x1", serial: "ABC123" }, { externalId: "x2", serial: "abc123" }, { externalId: "x3", hostname: "brand-new" }], true);
    expect(plan.matched.map((m) => m.record.externalId)).toEqual(["x1"]);
    expect(plan.ambiguous.map((a) => a.record.externalId)).toEqual(["x2"]);
    expect(plan.create.map((r) => r.externalId)).toEqual(["x3"]);
  });
});
