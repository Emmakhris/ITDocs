# ITDocs — IT Documentation Management System

Self-hosted web app for documenting IT: assets and **where they have moved**, locations, people, credentials, network, a knowledge base, software & licences, vendors & contracts, changes & incidents, a daily tech journal, diagrams, reports, email/Teams alerts, a REST API and AD/Intune/SCCM sync. It is built for hospitals but works for any industry; medical-device features can be switched off.

## Features by phase

| Phase | Scope | State |
|---|---|---|
| 1 | Foundation: AD/LDAP + break-glass login with MFA, roles, immutable audit log, search, settings | ✅ done |
| 2 | Locations, assets, custom asset types/fields, **movement log**, check-out/in, QR labels + phone scanning, disposal with wipe records, medical-device fields, CSV import/export | ✅ done |
| 3 | Password vault: AES-256-GCM, folder access control, audited reveal/copy, TOTP codes, password history, rotation reminders, links to assets | ✅ done |
| 4 | Network: IPAM with visual IP grid, VLANs, racks with U-layout, switch-port / patch-panel / wall-jack mapping, Wi-Fi linked to the vault | ✅ done |
| 5 | Knowledge base: Markdown SOPs and runbooks, full version history with diff and restore, templates, tags, categories, review reminders, attachments, links to assets and locations | ✅ done |
| 6 | Software & licences (encrypted keys, seat assignment, over-allocation and reclaim warnings), vendors & contracts (support contacts, notice-period reminders, covered assets, documents), renewals view | ✅ done |
| 7 | Changes with approval workflow, risk and clash warnings; incidents with timelines, root cause and time-to-resolve; daily tech / on-call journal | ✅ done |
| 8 | Diagrams (versioned uploads, linked to locations and assets), relationship map, 13 built-in reports with CSV / Excel / print and scheduled email, email + Teams alerts (daily digest, P1/P2 incidents) | ✅ done |
| 9 | REST API (OpenAPI) with scoped personal access tokens; Active Directory people sync; Intune and ConfigMgr device sync with dry-run previews | ✅ done |
| 10 | Hardening: database-backed rate limits, nonce-based Content Security Policy, health check, end-to-end test suite | ✅ done |

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

## Network (phase 4)

- **IPAM (IPv4).** Subnets are stored in CIDR form and normalised (`10.20.0.5/24` is rejected with a suggestion of `10.20.0.0/24`). Overlapping subnets are refused. Gateway, DHCP range and DNS are validated against the network. Subnets larger than a /16 are not supported.
- **IP grid.** Each subnet page shows its addresses as a grid (in /24 blocks for larger subnets): free, assigned, reserved, DHCP reservation, DHCP pool, gateway. Click a square to record or edit that address. **Allocate next free** takes the lowest free address outside the gateway and DHCP pool. Two people allocating at the same moment can't get the same address, because a unique index decides and the loser retries.
- **Rules.** An address must be a host address inside its subnet. It can't be the gateway (unless recorded as Reserved). It can't be a static assignment inside the DHCP pool; use *DHCP reservation* for those.
- **VLANs** are per site, so the same VLAN ID can exist at two sites. **Racks** show a front elevation; click an empty unit to mount an asset or a labelled item such as a patch panel. Overlaps and over-height placements are refused. **Switch ports** record the connected device, patch-panel port, wall jack, access VLAN or trunk VLAN list, and status. You can create a whole range (`Gi1/0/1–48`) at once. Search by wall jack to trace a cable.
- **Wi-Fi** networks record SSID, security, VLAN and site. The key or RADIUS secret stays in the vault: the network only links to the credential, and that link is shown only to people who can open its folder.
- **Asset page.** It lists the asset's IP addresses, the switch port it's patched into, its rack position and, for switches, the documented ports.
- Every change is audited; releasing an address or deleting a subnet keeps the old records in the audit entry.

## Knowledge base (phase 5)

- **Articles** are written in Markdown, with Write and Preview tabs and buttons for steps, checklists, tables and callouts such as `> [!WARNING]`. Raw HTML is never rendered: it shows as text, and links can only point to http(s), mailto or pages inside ITDocs.
- **Every save that changes the title or text creates a new version.** Versions can't be edited or deleted; a database trigger enforces this, as it does for the audit log. History shows who changed what, with a line-by-line diff between any two versions. Restoring an old version adds it as a new version, so nothing is lost. If two people edit the same article, the second save is refused rather than silently overwriting the first.
- **Templates.** SOP, runbook, new-starter onboarding and downtime-procedure templates are seeded. Technicians can add their own.
- **Who sees what.** Read-only and Auditor roles see published and archived articles. Drafts and templates are visible only to technicians and admins.
- **Review reminders.** Set "review every N days" on an article. Overdue articles are flagged in the knowledge base and on the dashboard. "Mark as reviewed" records the review in the audit log and schedules the next one.
- **Links and files.** Link articles to assets and locations; they appear in a *Documentation* panel on those pages. Attachments (up to 10 MB) are stored in `UPLOAD_DIR`, not in the database, so back that folder up too. Files are always downloaded, never opened in the browser.
- Global search covers article titles, text and tags.

## Software, vendors & contracts (phase 6)

- **Vendors** record support phone, email and portal, your account number, and named contacts. Keep portal logins in the password vault and link them to the contract. As elsewhere, the link is shown only to people who can open that vault folder.
- **Contracts** (support, maintenance, extended warranty, lease, subscription, service) record start and end dates, a **notice period**, auto-renewal, annual cost, SLA, the assets they cover, and attached documents. The key date is usually the **notice deadline** (end date minus notice period): miss it and an auto-renewing contract renews for another term. Contracts are flagged *Notice due soon* within 60 days of that deadline and *Notice period passed* once it's gone.
- **Renewals** (Vendors › Renewals, and a dashboard card) lists notice deadlines, contract ends and licence expiries for the next 30–180 days, plus anything that lapsed in the last 30.
- **Software licences** are per user, per device, concurrent, or site (unlimited). **Licence keys are encrypted** with the vault master key: only technicians and admins can reveal them, every reveal is audited, and `npm run vault:rotate` re-encrypts them along with vault secrets.
- **Seats** are assigned to a device or a person. Assigning past the seat count is allowed, because installs often come before paperwork, but the licence is flagged **over-allocated** on the licence, the software list ("compliance issues") and the dashboard. Seats held by retired, disposed or lost devices, or by people who have left, are highlighted as ones you can probably reclaim.
- Asset pages show the contracts covering the device (with the vendor's support number) and its licences. Person pages show their licences.

## Changes, incidents & journal (phase 7)

- **Changes** (CHG numbers) record type, risk, window, impact, and implementation, rollback and test plans (in Markdown). They move through *Draft → Awaiting approval → Approved → In progress → Completed / Failed / Rolled back*, and every step is recorded with who did it and why.
  - **Standard** changes are pre-approved routine work and can start straight from Draft.
  - **Emergency** changes can start before approval. They're flagged until someone approves them afterwards.
  - You can't approve your own change, and **high-risk changes need an administrator**.
  - Editing a change that's awaiting approval sends it back to Draft, so nobody approves a plan that changed after review.
  - Changes whose windows overlap are flagged, especially when they touch the same equipment.
- **Incidents** (INC numbers, P1–P4) have an **append-only timeline**, enforced by the database: status changes, severity and owner changes, and updates all go on it. Marking an incident resolved requires a resolution, and closing a P1 or P2 requires a root cause. Time to mitigate and time to resolve are shown, and an incident can be linked to the change that caused it.
- **Daily journal** is the shift and on-call log: short timestamped notes with tags, grouped by day, searchable, with on-call call-outs marked. Authors can correct their own entries for 24 hours; after that the record stands.
- Changes and incidents can list affected assets, and the asset page shows them. The dashboard shows open incidents and the next 7 days of change windows.
- Times you enter, like change windows and incident start times, are read in the **server's time zone**. Set `TZ` for the app container if it differs from local time.

## Diagrams, reports & alerts (phase 8)

- **Diagrams.** Upload network drawings, floor plans, rack photos, PDFs, SVG, draw.io or Visio files (up to 10 MB). The file type is detected from the file's content, not its name. Images and SVG show in the page; other types download. Uploading again keeps earlier versions. Diagrams link to a location and to the assets they show, and appear on those pages.
- **Relationship map** (Diagrams › Relationship map, or **Map** on an asset): shows everything connected to a record across modules — location, assignee, IPs and subnets, switch port, rack, licences, contracts, changes, incidents, articles, diagrams and vault credentials. Click any node to re-centre on it. You only see records your role can open, and credentials only from vault folders you can open.
- **Reports** (13 built in): inventory, assets by location, warranties ending, movements by period, PHI devices, preventive maintenance due, licence compliance, renewals, incidents (with mean time to resolve), changes (with success rate), knowledge-base reviews, password rotation due, and a user access review.
  - Each report checks the permission of the module it reads from, so Read-only users don't see vault reports and only admins and auditors see the access review.
  - Export to **CSV** or **Excel**. The `.xlsx` is written by the app itself: text cells are never treated as formulas, and dates are real Excel dates. Use **Print / PDF** for a PDF.
  - Every export is audited. Technicians and admins can **email a report on a schedule** (daily, weekly or monthly, as Excel or CSV).
- **Alerts** (Admin › Alerts):
  - A **daily digest**, sent by email and/or Teams after the configured hour, lists open incidents, changes awaiting approval, today's change windows, overdue check-outs, contract notice deadlines, over-allocated licences, warranties, maintenance and reviews due. Vault items are counted, never named. Days with nothing to report are skipped.
  - **P1/P2 incidents** alert immediately when opened or escalated.
  - Every attempt is recorded in a delivery log. The same alert never goes out twice, even if several app instances run the scheduler.
  - Set up `SMTP_*` and `TEAMS_WEBHOOK_URL` in `.env` (see `.env.example`), then use **Send test** on the Alerts page. The scheduler runs inside the app every 5 minutes; set `TZ` so the digest hour matches local time.

## API & integrations (phase 9)

- **REST API** at `/api/v1`, described at **`/api/v1/openapi.json`**. It covers assets (list, get, create, partial update, move, history), asset types, locations, people, subnets (and next-free IP allocation), changes, incidents (list and open — handy for monitoring tools), search and reports.
- **Tokens.** Everyone creates their own on **My profile › API tokens**. A token acts as its owner with the owner's role, and can be narrowed to **read-only** and to **specific modules**, with an expiry. Only a hash is stored and the token is shown once. Writes are audited like any other change (the audit entry shows `api:itd_…`). Admins see and revoke all tokens under Admin › Integrations & API.
  - The API only accepts `Authorization: Bearer itd_…`, never the browser session cookie, so a malicious web page can't make calls on a signed-in user's behalf.
  - The password vault, admin settings, and vault and audit reports are not available through the API.

  ```bash
  curl -H "Authorization: Bearer itd_…" "https://itdocs.example.local/api/v1/assets?q=latitude&pageSize=20"
  curl -X POST -H "Authorization: Bearer itd_…" -H "Content-Type: application/json" \
       -d '{"title":"Core switch down","severity":"P1"}' https://itdocs.example.local/api/v1/incidents
  ```
- **Sync** (Admin › Integrations & API). Every source has **Preview (dry run)**, and every run is logged with the full list of changes.
  - **Active Directory → people.** Creates and updates people. People already entered by hand are matched on employee ID or email. Disabled or removed accounts are deactivated, never deleted, and a run that would deactivate more than 20% of directory people stops unless you tick the override.
  - **Intune → devices** (Microsoft Graph). Matches devices to assets: an existing link first, then serial number, then hostname. Hostname and OS are updated; make, model and serial are filled in if empty. Last check-in, compliance state and primary user are shown on the asset. **Location and assignee are never changed** — moves stay in the movement log. Unknown devices are listed, or created if you tick that box.
  - **ConfigMgr (SCCM) → devices** from a CSV export. Columns: Name, SerialNumber, Manufacturer, Model, OperatingSystem, LastLogonUser, ResourceID; the raw view names such as `Netbios_Name0` also work. A suitable query against the ConfigMgr database:
    ```sql
    SELECT s.ResourceID, s.Netbios_Name0 AS Name, b.SerialNumber0 AS SerialNumber, c.Manufacturer0 AS Manufacturer,
           c.Model0 AS Model, o.Caption0 AS OperatingSystem, s.User_Name0 AS LastLogonUser
    FROM v_R_System s
    LEFT JOIN v_GS_PC_BIOS b ON b.ResourceID = s.ResourceID
    LEFT JOIN v_GS_COMPUTER_SYSTEM c ON c.ResourceID = s.ResourceID
    LEFT JOIN v_GS_OPERATING_SYSTEM o ON o.ResourceID = s.ResourceID
    WHERE s.Obsolete0 = 0
    ```
  - Set `SYNC_AUTO=ad,intune` to run those syncs daily. See `.env.example` for the Intune app registration and the LDAP attribute settings.

## Security hardening (phase 10)

- **Rate limits** are stored in the database, so they're shared by every app instance and survive restarts. When a limit is hit, the response is `429` with `Retry-After`; for API tokens the `X-RateLimit-*` headers show the remaining allowance.

  | What | Limit |
  |---|---|
  | Failed sign-ins per username + IP | 5 in 15 min, then locked out for 15 min (audited) |
  | Sign-in attempts per IP | 50 in 15 min, to stop password spraying |
  | REST API calls per token | 600 per minute (`API_RATE_LIMIT`) |
  | Vault and licence-key reveals per person | 60 in 10 min (hitting the cap is audited) |
  | Search and lookups per person | 240 per minute |

- **Content Security Policy.** Each page gets a fresh nonce, so only the app's own scripts can run, and injected markup can't execute anything. Pages can't be framed, plugins are blocked, and forms can only post to the app. Other headers set: HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, COOP and CORP.
- **Uploaded files** are always served as downloads (diagram images excepted) with a sandboxed CSP. Their type is checked by content, not file name.
- **`/api/health`** reports only `ok` or `error`. The Docker Compose file uses it as the app's healthcheck.
- **End-to-end tests** (Playwright) drive a real browser through sign-in, assets, the movement log, the vault, the API, the security headers and the rate limits. See *Development*.

## Production install (Docker, Linux)

```bash
git clone <repo> itdocs && cd itdocs
cp .env.example .env          # then edit: POSTGRES_PASSWORD, APP_URL, LDAP_*, BOOTSTRAP_ADMIN_*, VAULT_MASTER_KEY
docker compose up -d --build
docker compose exec app npx tsx prisma/seed.ts   # first run: break-glass admin, AD group mappings, asset types, KB templates
```

The seed is safe to run again; it only adds what's missing. It never creates demo data unless you pass `--demo`, which is meant for development and evaluation only.

### Updating

```bash
git pull
docker compose up -d --build                     # the app applies new database migrations on start
docker compose exec app npx tsx prisma/seed.ts   # optional: adds any new default templates or settings
docker compose ps                                # wait for the app to show "healthy" (/api/health)
```

Take a backup first (see *Backups*). Migrations only move forward and are applied automatically by `prisma migrate deploy` at start-up. Check the README for new `.env` settings after each update; `.env.example` lists them all.

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
npm run db:seed           # base data + the demo hospital (--demo) + break-glass admin from .env
npm run dev               # http://localhost:3000
```

If Docker is available, `docker compose -f docker-compose.dev.yml up -d` starts Postgres **and an OpenLDAP server that simulates AD** on `ldap://localhost:1389`. (Port 3389 is avoided because it is Windows Remote Desktop.) Test users are `aadmin`, `jtech`, `rviewer` and `nogroup`, all with password `Passw0rd!`. OpenLDAP isn't AD, so for the people sync set `LDAP_SYNC_FILTER=(objectClass=inetOrgPerson)`, `LDAP_SYNC_ID_ATTR=entryUUID` and `LDAP_SYNC_EMPLOYEEID_ATTR=employeeNumber`.

### Tests

```bash
DATABASE_URL=postgresql://itdocs:itdocs@localhost:5433/itdocs_test npx prisma migrate deploy   # once
npm test                                                   # unit + integration tests (Vitest)
DATABASE_URL=...itdocs_test npm run db:seed-large -- 50000 && PERF=1 npx vitest run tests/perf.test.ts
```

End-to-end tests drive a real browser (Playwright) against a production build on port 3100 and a separate `itdocs_e2e` database. Before each run its migrations are applied and the seed is run; both are non-destructive, and the tests use unique names, so nothing is wiped. The setup refuses any database whose name doesn't end in `_e2e`.

```bash
npx playwright install chromium   # once
npm run test:e2e                  # report in playwright-report/
```

## Architecture

- Next.js 15 (App Router, server actions) + TypeScript; PostgreSQL 16 + Prisma; Tailwind CSS. System fonts only, so it builds offline / air-gapped.
- **All writes go through `src/server/modules/*`**, which enforce RBAC and write the audit log in the same transaction. Pages, server actions and the REST API (`src/app/api/v1`, via `src/server/api/handler.ts`) all call these services.
- `src/server/modules/assets.ts › recordMovement()` is the single function that writes movement history.
- `src/server/crypto/vault.ts` is the only code that touches vault keys; `src/server/modules/vault.ts › reveal()` is the only path that returns a decrypted secret.
- Sessions are random tokens stored hashed in the DB, with an idle timeout (`SESSION_IDLE_MINUTES`) and a maximum lifetime. Disabling a user kills their sessions.
- Security: the Content Security Policy (per-request nonce) and the session gate are in `src/middleware.ts`; other headers are in `next.config.ts`; rate limits in `src/server/lib/rate-limit.ts`. CSV and Excel exports are protected against formula injection, and LDAP filter input is escaped.
- Background jobs (alert digest, scheduled reports, syncs, rate-limit cleanup) run in-process from `src/instrumentation.ts` → `src/server/scheduler.ts`.
- **Contributing:** see [`CLAUDE.md`](CLAUDE.md) for the code layout, the rules every change must follow (RBAC + audit in one transaction, append-only tables, the movement log), conventions, known pitfalls, and how to test and verify.
