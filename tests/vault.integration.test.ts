import crypto from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { Ctx } from "@/server/context";
import { aad, decrypt, encrypt, keyIdOf } from "@/server/crypto/vault";
import {
  addFolderGrant,
  createCredential,
  credentialsForAsset,
  getCredential,
  linkAsset,
  listCredentials,
  listFolders,
  normaliseTotpSeed,
  reveal,
  saveFolder,
  updateCredential,
} from "@/server/modules/vault";
import { ForbiddenError } from "@/server/lib/errors";

const run = Date.now().toString(36);
const mkUser = async (role: "ADMIN" | "TECHNICIAN" | "READONLY" | "AUDITOR", name: string): Promise<Ctx> => {
  const u = await db.user.create({ data: { username: `v-${name}-${run}`, displayName: `${name} ${run}`, role, source: "LOCAL" } });
  return { user: { id: u.id, username: u.username, displayName: u.displayName, role } };
};

let admin: Ctx, tech: Ctx, tech2: Ctx, viewer: Ctx, auditor: Ctx;
let openFolder: string, secretFolder: string;

beforeAll(async () => {
  [admin, tech, tech2, viewer, auditor] = await Promise.all([
    mkUser("ADMIN", "admin"),
    mkUser("TECHNICIAN", "tech"),
    mkUser("TECHNICIAN", "tech2"),
    mkUser("READONLY", "viewer"),
    mkUser("AUDITOR", "auditor"),
  ]);
  openFolder = (await saveFolder(admin, null, { name: `Network ${run}` })).id;
  secretFolder = (await saveFolder(admin, null, { name: `Domain admins ${run}`, restricted: "on" })).id;
});

const auditCount = (entityId: string, action = "view_sensitive") => db.auditLog.count({ where: { entityId, action } });

describe("vault crypto", () => {
  it("round-trips, uses a fresh IV each time, and binds ciphertext to its record", () => {
    const a = encrypt("Tr0ub4dor&3", aad.secret("id-1"));
    const b = encrypt("Tr0ub4dor&3", aad.secret("id-1"));
    expect(a).not.toBe(b);
    expect(a).not.toContain("Tr0ub4dor");
    expect(decrypt(a, aad.secret("id-1"))).toBe("Tr0ub4dor&3");
    expect(() => decrypt(a, aad.secret("id-2"))).toThrow(); // swapped onto another record
    const parts = a.split(".");
    parts[4] = Buffer.from("tampered").toString("base64url");
    expect(() => decrypt(parts.join("."), aad.secret("id-1"))).toThrow(); // GCM auth tag check
  });

  it("decrypts values from a previous key listed in VAULT_OLD_MASTER_KEYS", () => {
    const original = process.env.VAULT_MASTER_KEY!;
    const oldValue = encrypt("old-secret", aad.secret("x"));
    process.env.VAULT_MASTER_KEY = crypto.randomBytes(32).toString("base64");
    try {
      expect(() => decrypt(oldValue, aad.secret("x"))).toThrow(/not available/);
      process.env.VAULT_OLD_MASTER_KEYS = original;
      expect(decrypt(oldValue, aad.secret("x"))).toBe("old-secret");
      expect(keyIdOf(encrypt("new", aad.secret("x")))).not.toBe(keyIdOf(oldValue));
    } finally {
      process.env.VAULT_MASTER_KEY = original;
      process.env.VAULT_OLD_MASTER_KEYS = "";
    }
  });

  it("normalises TOTP seeds and otpauth links", () => {
    expect(normaliseTotpSeed("jbsw y3dp ehpk 3pxp")).toBe("JBSWY3DPEHPK3PXP");
    expect(normaliseTotpSeed("otpauth://totp/Acme:bob?secret=JBSWY3DPEHPK3PXP&issuer=Acme")).toBe("JBSWY3DPEHPK3PXP");
    expect(() => normaliseTotpSeed("not-base32!")).toThrow();
  });
});

describe("credentials", () => {
  it("stores only ciphertext, reveals plaintext, and audits every reveal and copy", async () => {
    const c = await createCredential(tech, { folderId: openFolder, title: "Core switch", username: "admin", password: "S3cret-Switch!", totpSeed: "JBSWY3DPEHPK3PXP" });
    const row = await db.credential.findUniqueOrThrow({ where: { id: c.id } });
    expect(row.secretEnc).not.toContain("S3cret");
    expect(row.totpEnc).not.toContain("JBSWY3DP");

    expect(await auditCount(c.id)).toBe(0);
    expect(await reveal(tech, c.id, { field: "password" })).toBe("S3cret-Switch!");
    expect(await reveal(tech2, c.id, { field: "password" }, "copy")).toBe("S3cret-Switch!");
    expect(await reveal(tech, c.id, { field: "totp" })).toMatch(/^\d{6}$/);
    expect(await auditCount(c.id)).toBe(3);
    const entries = await db.auditLog.findMany({ where: { entityId: c.id, action: "view_sensitive" }, orderBy: { id: "asc" } });
    expect(entries.map((e) => e.summary)).toEqual([
      'Revealed password of "Core switch"',
      'Copied password of "Core switch"',
      'Revealed TOTP code of "Core switch"',
    ]);
    expect(entries[1].actorId).toBe(tech2.user.id);

    // No secret ever lands in the audit log
    const leaks = await db.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*) n FROM "AuditLog" WHERE coalesce(summary,'') || coalesce(before::text,'') || coalesce(after::text,'') LIKE '%S3cret%' OR coalesce(after::text,'') LIKE '%JBSWY3DP%'`,
    );
    expect(Number(leaks[0].n)).toBe(0);
  });

  it("keeps encrypted password history and schedules rotation", async () => {
    const c = await createCredential(tech, { folderId: openFolder, title: "UPS web UI", password: "first-pass", rotateEveryDays: "90" });
    expect(c.rotationDueAt!.getTime() - c.passwordChangedAt.getTime()).toBe(90 * 86_400_000);
    await updateCredential(tech, c.id, { folderId: openFolder, title: "UPS web UI", rotateEveryDays: "90" }); // blank password = keep
    expect(await reveal(tech, c.id, { field: "password" })).toBe("first-pass");
    await updateCredential(tech, c.id, { folderId: openFolder, title: "UPS web UI", password: "second-pass", rotateEveryDays: "90" });
    const detail = await getCredential(tech, c.id);
    expect(detail.history).toHaveLength(1);
    expect(await reveal(tech, c.id, { field: "password" })).toBe("second-pass");
    expect(await reveal(tech, c.id, { field: "history", historyId: detail.history[0].id })).toBe("first-pass");
    expect(detail).not.toHaveProperty("secretEnc");
  });

  it("denies the vault entirely to read-only and auditor roles", async () => {
    const c = await createCredential(admin, { folderId: openFolder, title: "Printer admin", password: "pw-123" });
    for (const who of [viewer, auditor]) {
      await expect(listFolders(who)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(reveal(who, c.id, { field: "password" })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(createCredential(who, { folderId: openFolder, title: "x", password: "y" })).rejects.toBeInstanceOf(ForbiddenError);
    }
    expect(await auditCount(c.id)).toBe(0);
  });

  it("enforces restricted folders with view / edit grants", async () => {
    const c = await createCredential(admin, { folderId: secretFolder, title: "DA account", password: "domain-admin-pw" });
    // No grant: invisible and unreadable
    expect((await listFolders(tech)).some((f) => f.id === secretFolder)).toBe(false);
    expect((await listCredentials(tech)).some((x) => x.id === c.id)).toBe(false);
    await expect(reveal(tech, c.id, { field: "password" })).rejects.toBeInstanceOf(ForbiddenError);

    // View grant for one user
    await addFolderGrant(admin, secretFolder, { userId: tech.user.id, level: "VIEW" });
    expect(await reveal(tech, c.id, { field: "password" })).toBe("domain-admin-pw");
    await expect(updateCredential(tech, c.id, { folderId: secretFolder, title: "renamed" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(reveal(tech2, c.id, { field: "password" })).rejects.toBeInstanceOf(ForbiddenError);

    // Edit grant for the whole technician role
    await addFolderGrant(admin, secretFolder, { role: "TECHNICIAN", level: "EDIT" });
    await updateCredential(tech2, c.id, { folderId: secretFolder, title: "DA account (renamed)" });
    expect((await getCredential(tech2, c.id)).title).toBe("DA account (renamed)");
    await expect(addFolderGrant(admin, secretFolder, { role: "READONLY" })).rejects.toThrow(/cannot access/);
  });

  it("links credentials to assets, hiding ones the viewer cannot access", async () => {
    const type = await db.assetType.create({ data: { name: `Firewall ${run}` } });
    const asset = await db.asset.create({ data: { tag: `VT-${run}`, name: "Edge firewall", typeId: type.id } });
    const open = await createCredential(admin, { folderId: openFolder, title: "FW admin", password: "fw" });
    const hiddenFolder = (await saveFolder(admin, null, { name: `Break-glass ${run}`, restricted: "on" })).id;
    const hidden = await createCredential(admin, { folderId: hiddenFolder, title: "FW emergency", password: "fw2" });
    await linkAsset(admin, open.id, asset.id);
    await linkAsset(admin, hidden.id, asset.id);
    expect((await credentialsForAsset(admin, asset.id)).map((c) => c.title).sort()).toEqual(["FW admin", "FW emergency"]);
    expect((await credentialsForAsset(tech2, asset.id)).map((c) => c.title)).toEqual(["FW admin"]);
    expect(await credentialsForAsset(viewer, asset.id)).toEqual([]);
  });
});
