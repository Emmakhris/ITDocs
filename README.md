# ITDocs — IT Documentation Management System

Self-hosted web app for documenting IT: assets and **where they have moved**, locations, people, and (in later phases) credentials, network, knowledge base, software & licences, vendors & contracts, changes & incidents. It is built for hospitals but works for any industry; medical-device features can be switched off.

## Status

| Phase | Scope | State |
|---|---|---|
| 1 | Foundation: AD/LDAP + break-glass login with MFA, roles, immutable audit log, search, settings | ✅ done |
| 2 | Locations, assets, custom asset types/fields, **movement log**, check-out/in, QR labels + phone scanning, disposal with wipe records, medical-device fields, CSV import/export | ✅ done |
| 3 | Password vault: AES-256-GCM, folder access control, audited reveal/copy, TOTP codes, password history, rotation reminders, links to assets | ✅ done |
| 4 | Network: IPAM, VLANs, racks, switch ports, Wi-Fi | planned |
| 5 | Knowledge base / SOPs with versions & templates | planned |
| 6 | Software & licences, vendors & contracts | planned |
| 7 | Changes, incidents, daily journal | planned |
| 8 | Diagrams, relationship map, reports, email/Teams alerts | planned |
| 9 | REST API + tokens, AD/Intune/SCCM sync | planned |
| 10 | Hardening: rate limits, CSP, e2e suite | planned |

## Key features (phases 1–2)

- **Movement tracking.** Every change to an asset's location, assignee or status writes an `AssetMovement` row: from/to location (with the full path saved at that moment), from/to person, from/to status, reason, ticket #, who and when. This covers the move form, bulk move, QR scan, check-out/in, import, edits and disposal. There is also a "where was this device on date X?" lookup. History is **append-only**, enforced by a database trigger.
- **Audit trail.** Sign-ins (including failures), every change with before/after values, views of PHI-flagged devices, and exports. Append-only; it can be filtered and exported to CSV.
- **QR / barcode labels.** Print on Letter/A4 sheets or a label printer. Scanning a label with a phone camera opens a quick page to confirm the location (inventory audit), move, or check in.
- **Custom asset types.** Admins define types (e.g. *Infusion Pump*) and their fields (text, number, date, drop-down, yes/no, URL) without code.
- **Lifecycle.** Ordered → In stock → Deployed → In repair / Loaned → Retired → Disposed. Disposal records the method, NIST 800-88 wipe method, certificate # and witness. A wipe method is **mandatory** for PHI devices.
- **Roles.** Administrator, Technician, Read-only, Auditor. AD groups map to roles.

## Password vault (phase 3)

- **Encryption.** Secrets, TOTP seeds and old passwords are encrypted with AES-256-GCM, using a random IV per value and the record id bound as additional authenticated data. The master key `VAULT_MASTER_KEY` lives only in `.env` and never in the database or its backups. Titles, usernames, URLs and notes are *not* encrypted, so they stay searchable. Don't put secrets in notes.
- **Who can see what.** Only Administrators and Technicians can use the vault; Read-only and Auditor roles are blocked. Folders are open to every technician unless an admin marks them **restricted**. A restricted folder is visible only to admins and to the roles or users granted *view* or *edit* on it.
- **Every reveal and copy is logged.** Each one writes a `view_sensitive` audit entry (who, when, IP, which field) before the value leaves the server. It shows on the credential's access log and under Audit log › `view_sensitive`. Revealed values hide again after 30 s, and copied values are cleared from the clipboard after 30 s.
- **TOTP.** Paste a base32 seed or the `otpauth://` link from a QR code, and the vault shows the current 6-digit code. Showing the code is audited too.
- **History and rotation.** Changing a password keeps the old one, encrypted, in its history. An optional "rotate every N days" setting flags the credential when it's due.
- **Linked assets.** Credentials can be linked to assets. The asset page lists linked credentials that the viewer is allowed to see.

### Rotating the master key

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # new key
# .env: VAULT_OLD_MASTER_KEYS=<old key>   VAULT_MASTER_KEY=<new key>   then restart the app
npm run vault:rotate -- --dry-run      # in Docker: docker compose exec app npx tsx scripts/vault-rotate-key.ts --dry-run
npm run vault:rotate                   # re-encrypts everything; safe to re-run
# when it reports "Remaining on old keys: 0", remove VAULT_OLD_MASTER_KEYS and restart
```

**If you lose `VAULT_MASTER_KEY`, the stored secrets cannot be recovered.** Keep a copy offline, e.g. sealed with the break-glass password.

## Production install (Docker, Linux)

```bash
git clone <repo> itdocs && cd itdocs
cp .env.example .env          # then edit: POSTGRES_PASSWORD, APP_URL, LDAP_*, BOOTSTRAP_ADMIN_*, VAULT_MASTER_KEY
docker compose up -d --build
docker compose exec app npx tsx prisma/seed.ts   # first run only: break-glass admin, default AD group mappings, asset types
```

The app listens on `127.0.0.1:3000`. Put TLS in front of it with the example in `docker/Caddyfile` (uncomment the `caddy` service) or your existing reverse proxy. Phone camera scanning **requires HTTPS**.

### Active Directory

Set these in `.env`:

| Variable | Example |
|---|---|
| `LDAP_URL` | `ldaps://dc01.corp.local:636` |
| `LDAP_BIND_DN` / `LDAP_BIND_PASSWORD` | a read-only service account |
| `LDAP_BASE_DN` | `DC=corp,DC=local` |
| `LDAP_USER_FILTER` | `(&(objectClass=user)(sAMAccountName={{username}}))` |

Users can sign in as `jsmith` or `CORP\jsmith`. Group membership comes from `memberOf` plus `LDAP_GROUP_FILTER`. Map groups to roles in **Administration › Users & directory**. The defaults are `IT-Admins`, `IT-Technicians`, `IT-Auditors` and `IT-ReadOnly`. A user who is not in any mapped group is refused.

**Break-glass:** the seed creates `BOOTSTRAP_ADMIN_USERNAME` as a local admin, which still works when AD is down. Sign in, open **My profile**, and enrol an authenticator app right away. Remove `BOOTSTRAP_ADMIN_PASSWORD` from `.env` afterwards.

### Backups

The `backup` service writes a nightly `pg_dump` to `./backups` and keeps 14 days. To restore:

```bash
docker compose exec -T db pg_restore -U itdocs -d itdocs --clean < backups/itdocs-YYYY-MM-DD.dump
```

Back up the `uploads` volume and your `.env` separately. Keep `VAULT_MASTER_KEY` **out of** the database backups.

## Development (Windows/macOS/Linux, no Docker needed)

```bash
npm install
npm run db:dev            # embedded PostgreSQL on :5433 — leave running
npx prisma migrate deploy
npm run db:seed           # demo hospital data + break-glass admin from .env
npm run dev               # http://localhost:3000
```

If Docker is available, `docker compose -f docker-compose.dev.yml up -d` starts Postgres **and an OpenLDAP server that simulates AD**. Test users are `aadmin`, `jtech`, `rviewer` and `nogroup`, all with password `Passw0rd!`.

### Tests

```bash
DATABASE_URL=postgresql://itdocs:itdocs@localhost:5433/itdocs_test npx prisma migrate deploy   # once
npm test                                                   # unit + integration (movement, check-out, disposal, RBAC, immutability, vault)
DATABASE_URL=...itdocs_test npm run db:seed-large -- 50000 && PERF=1 npx vitest run tests/perf.test.ts
```

## Architecture

- Next.js 15 (App Router, server actions) + TypeScript; PostgreSQL 16 + Prisma; Tailwind CSS. System fonts only, so it builds offline / air-gapped.
- **All writes go through `src/server/modules/*`**, which enforce RBAC and write the audit log in the same transaction. Pages and (later) the REST API call these services.
- `src/server/modules/assets.ts › recordMovement()` is the single function that writes movement history.
- `src/server/crypto/vault.ts` is the only code that touches vault keys; `src/server/modules/vault.ts › reveal()` is the only path that returns a decrypted secret.
- Sessions are random tokens stored hashed in the DB, with an idle timeout (`SESSION_IDLE_MINUTES`) and a maximum lifetime. Disabling a user kills their sessions.
- Security headers are set in `next.config.ts`. CSV exports are protected against formula injection, and LDAP filter input is escaped.
