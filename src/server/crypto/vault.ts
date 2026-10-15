/**
 * Vault encryption: AES-256-GCM with a master key held outside the database.
 *
 *   VAULT_MASTER_KEY       base64 of 32 random bytes — encrypts everything new
 *   VAULT_OLD_MASTER_KEYS  optional, comma-separated previous keys — decrypt only (during rotation)
 *
 * Ciphertext: "v1.<keyId>.<iv>.<tag>.<ciphertext>" (base64url parts). keyId = first 8 hex chars of
 * sha256(key), so each value says which key encrypted it. A per-value random 96-bit IV is used and an
 * "AAD" context string (e.g. "cred:<id>:secret") binds the ciphertext to its record and field, so an
 * encrypted value copied onto another record will not decrypt.
 *
 * No "server-only" import: the key-rotation script uses this module from the command line.
 */
import crypto from "node:crypto";

type Key = { id: string; key: Buffer };

function parseKey(b64: string, label: string): Key {
  const key = Buffer.from(b64.trim(), "base64");
  if (key.length !== 32) throw new Error(`${label} must be 32 bytes, base64-encoded (got ${key.length} bytes).`);
  return { id: crypto.createHash("sha256").update(key).digest("hex").slice(0, 8), key };
}

let cache: { raw: string; current: Key; all: Map<string, Key> } | null = null;

function keys() {
  const raw = `${process.env.VAULT_MASTER_KEY ?? ""}|${process.env.VAULT_OLD_MASTER_KEYS ?? ""}`;
  if (cache?.raw === raw) return cache;
  if (!process.env.VAULT_MASTER_KEY) throw new Error("VAULT_MASTER_KEY is not set — the password vault is unavailable.");
  const current = parseKey(process.env.VAULT_MASTER_KEY, "VAULT_MASTER_KEY");
  const all = new Map([[current.id, current]]);
  for (const k of (process.env.VAULT_OLD_MASTER_KEYS ?? "").split(",").filter((s) => s.trim())) {
    const old = parseKey(k, "VAULT_OLD_MASTER_KEYS entry");
    all.set(old.id, old);
  }
  cache = { raw, current, all };
  return cache;
}

export function vaultConfigured() {
  try {
    keys();
    return true;
  } catch {
    return false;
  }
}

export function currentKeyId() {
  return keys().current.id;
}

export function encrypt(plaintext: string, aad: string): string {
  const { current } = keys();
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", current.key, iv);
  c.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([c.update(plaintext, "utf8"), c.final()]);
  const b = (x: Buffer) => x.toString("base64url");
  return ["v1", current.id, b(iv), b(c.getAuthTag()), b(ct)].join(".");
}

export function decrypt(value: string, aad: string): string {
  const [ver, keyId, iv, tag, ct] = value.split(".");
  if (ver !== "v1" || ct === undefined || [keyId, iv, tag].some((p) => !p)) throw new Error("Unrecognised ciphertext format.");
  const k = keys().all.get(keyId);
  if (!k) throw new Error(`Encryption key ${keyId} is not available. Add it to VAULT_OLD_MASTER_KEYS.`);
  const d = crypto.createDecipheriv("aes-256-gcm", k.key, Buffer.from(iv, "base64url"));
  d.setAAD(Buffer.from(aad, "utf8"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
}

/** Key id embedded in a ciphertext (used by the rotation script to skip already-rotated values). */
export const keyIdOf = (value: string) => value.split(".")[1];

/** AAD context strings — keep stable; changing them makes existing data undecryptable. */
export const aad = {
  secret: (credentialId: string) => `cred:${credentialId}:secret`,
  totp: (credentialId: string) => `cred:${credentialId}:totp`,
  history: (credentialId: string) => `cred:${credentialId}:history`,
  license: (licenseId: string) => `license:${licenseId}:key`,
};
