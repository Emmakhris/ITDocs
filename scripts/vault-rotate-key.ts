/**
 * Re-encrypt every vault secret and software licence key with the current VAULT_MASTER_KEY.
 *
 * Rotation procedure:
 *   1. Generate a new key:  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 *   2. In .env: move the old key into VAULT_OLD_MASTER_KEYS and set VAULT_MASTER_KEY to the new key.
 *   3. Restart the app (it can now read both), then run:  npm run vault:rotate            (add --dry-run to preview)
 *   4. When it reports 0 remaining, remove the old key from VAULT_OLD_MASTER_KEYS and restart again.
 *
 * Each row is re-encrypted in its own transaction, so the script is safe to re-run after an interruption.
 */
import { PrismaClient } from "@prisma/client";
import { aad, currentKeyId, decrypt, encrypt, keyIdOf } from "../src/server/crypto/vault";

const db = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");

async function main() {
  const cur = currentKeyId();
  console.log(`Current key id: ${cur}${dryRun ? " (dry run)" : ""}`);
  let creds = 0;
  let hist = 0;
  let keys = 0;

  for (const c of await db.credential.findMany({ select: { id: true, secretEnc: true, totpEnc: true } })) {
    const stale = keyIdOf(c.secretEnc) !== cur || (c.totpEnc && keyIdOf(c.totpEnc) !== cur);
    if (!stale) continue;
    const data = {
      secretEnc: encrypt(decrypt(c.secretEnc, aad.secret(c.id)), aad.secret(c.id)),
      totpEnc: c.totpEnc ? encrypt(decrypt(c.totpEnc, aad.totp(c.id)), aad.totp(c.id)) : null,
    };
    if (!dryRun) await db.credential.update({ where: { id: c.id }, data });
    creds++;
  }
  for (const h of await db.credentialHistory.findMany({ select: { id: true, credentialId: true, secretEnc: true } })) {
    if (keyIdOf(h.secretEnc) === cur) continue;
    const secretEnc = encrypt(decrypt(h.secretEnc, aad.history(h.credentialId)), aad.history(h.credentialId));
    if (!dryRun) await db.credentialHistory.update({ where: { id: h.id }, data: { secretEnc } });
    hist++;
  }
  for (const l of await db.license.findMany({ where: { keyEnc: { not: null } }, select: { id: true, keyEnc: true } })) {
    if (keyIdOf(l.keyEnc!) === cur) continue;
    const keyEnc = encrypt(decrypt(l.keyEnc!, aad.license(l.id)), aad.license(l.id));
    if (!dryRun) await db.license.update({ where: { id: l.id }, data: { keyEnc } });
    keys++;
  }

  if (!dryRun && (creds || hist || keys)) {
    await db.auditLog.create({
      data: {
        actorName: "system",
        action: "key_rotation",
        entityType: "Vault",
        summary: `Re-encrypted ${creds} credential(s), ${hist} history entr(ies) and ${keys} licence key(s) with key ${cur}`,
      },
    });
  }
  const remaining =
    (await db.credential.findMany({ select: { secretEnc: true, totpEnc: true } })).filter(
      (c) => keyIdOf(c.secretEnc) !== cur || (c.totpEnc && keyIdOf(c.totpEnc) !== cur),
    ).length +
    (await db.credentialHistory.findMany({ select: { secretEnc: true } })).filter((h) => keyIdOf(h.secretEnc) !== cur).length +
    (await db.license.findMany({ where: { keyEnc: { not: null } }, select: { keyEnc: true } })).filter((l) => keyIdOf(l.keyEnc!) !== cur).length;
  console.log(`${dryRun ? "Would re-encrypt" : "Re-encrypted"}: ${creds} credential(s), ${hist} history entr(ies), ${keys} licence key(s). Remaining on old keys: ${dryRun ? "n/a" : remaining}.`);
}

main()
  .catch((e) => {
    console.error("Rotation failed:", (e as Error).message);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
