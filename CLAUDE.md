# CLAUDE.md — working on ITDocs

Self-hosted IT documentation system for a hospital (works for any industry). Next.js 15 App Router + TypeScript, PostgreSQL 16 + Prisma 6, Tailwind 4, Zod 4. See README.md for features, install and operations. This file is for people (and agents) changing the code.

## Commands

```bash
npm run db:dev        # embedded Postgres on :5433 (keep running; data in ./data/pg)
npm run dev           # http://localhost:3000
npm run typecheck     # tsc --noEmit
npm run lint          # eslint (must be clean)
npm test              # Vitest unit + integration, against the itdocs_test database
npm run test:e2e      # Playwright: prod build on :3100 + itdocs_e2e database (non-destructive setup)
npx prisma migrate dev --name <name> --create-only   # new migration (review the SQL, then:)
npx prisma migrate deploy                            # apply to dev
DATABASE_URL=postgresql://itdocs:itdocs@localhost:5433/itdocs_test npx prisma migrate deploy   # and to the test DB
npm run db:seed       # idempotent; base data + demo hospital (--demo). Production runs the seed WITHOUT --demo
```

Before calling work done: typecheck, lint, `npm test`, and for UI or security changes a production build checked in a browser (see *Verifying in a browser*). Run `npm run test:e2e` when touching auth, middleware/CSP, the API or the core asset/vault flows.

## Architecture rules (keep these)

- **All reads and writes go through `src/server/modules/*`.** Every module function takes a `Ctx`, calls `assertCan(role, module, "read" | "write")` first, and writes `audit()` **in the same `db.$transaction`** as the change. Pages, server actions (`src/app/(app)/**/actions.ts`) and the REST API (`src/app/api/v1`) are thin wrappers around these functions.
- **RBAC** lives in `src/server/rbac/permissions.ts`: modules `assets locations people vault network kb software vendors changes reports audit admin`. Roles: ADMIN, TECHNICIAN (no audit/admin), READONLY (no vault), AUDITOR (read-only plus the audit log).
- **Append-only tables**, enforced by Postgres triggers in the migrations: `AuditLog`, `AssetMovement`, `ArticleVersion` and `IncidentUpdate`. Corrections are new rows. Never add update or delete paths for them.
- **Asset placement:** every change to an asset's location, assignee or status must go through `recordMovement()` in `assets.ts`. Syncs (Intune/SCCM) deliberately never change location or assignee.
- **Secrets:** only `src/server/crypto/vault.ts` touches keys (AES-256-GCM, record id bound as AAD via `aad.*`). Decrypted values leave the server only through `vault.reveal()` and `software.revealLicenseKey()`, both audited (`view_sensitive`) and rate-limited (`revealAllowed`). If you add an encrypted column, add it to `scripts/vault-rotate-key.ts`.
- **Visibility rules filter, never replace.** When combining a role-based visibility condition with user filters, use `AND: [visible(ctx), ...filters]` (see `kb.ts listArticles`). Spreading objects silently overwrote a "hide drafts" rule once.
- **Pure logic goes in `src/server/lib/*`** (no DB): IP maths, renewals, workflows, sync planning, XLSX, file sniffing, rate-limit policy. Unit-test it there. `src/lib/*` (Markdown renderer, diff) is shared with client components.
- **Files** go through `src/server/lib/storage.ts` (random keys under `UPLOAD_DIR/<area>/`). They're served only via `/api/files/[id]`, which dispatches to the owning module's reader to check access. Always download, `nosniff`, sandbox CSP. File types are detected from content (`filetype.ts`), never from the name.
- **REST API:** wrap handlers in `api(module | null, "read" | "write", fn)` from `src/server/api/handler.ts`. It handles bearer auth, scopes, read-only tokens, rate limit and error format. Return shapes via `src/server/api/serializers.ts` so DB changes don't break clients. Keep `src/app/api/v1/openapi.json/route.ts` in sync. Never expose vault data through the API.
- **Global search:** add new record types to `src/server/modules/search.ts`, filtered by `can(...)`, and map the hit kind to a scope in `src/app/api/v1/search/route.ts`.
- **Scheduler:** `src/instrumentation.ts` → `src/server/scheduler.ts` (5-minute tick: digest, scheduled reports, rate-limit sweep, `SYNC_AUTO` syncs). Keep the `if (process.env.NEXT_RUNTIME === "nodejs")` block in exactly that form, or the edge build fails on `node:` imports.

## Conventions

- Forms: `ActionForm` + `Field` + `Submit` from `src/components/form.tsx`. Server actions return `ActionState`, use `toActionError()`, and `redirect()` on success. Inputs use `id` = field name so `Field` labels and errors attach. List pages use `?edit=<id|new>` for inline create/edit.
- Zod input schemas live next to the module (`xxxInput`). Optional text: `optStr(max)`. Dates and numbers: `optDate` / `optNum`. Checkboxes: `checkbox`.
- **Zod 4 drops absent optional keys**, so for updates that must clear fields use `nulls(schema, parsed)` from `lib/forms.ts` (or explicit `?? null`). Blank required fields arrive as `undefined`, and `issueMessage()` turns Zod's "received undefined" into "This field is required".
- Filter/search rows: inputs are `w-full`, so lay forms out with a grid (`grid sm:grid-cols-[minmax(0,22rem)_auto]`), not width classes.
- UI copy is plain and specific: say what happened and what to do. Destructive buttons use `ConfirmSubmit`.
- Markdown (KB, change plans, journal) only through `renderMarkdown()` in `src/lib/markdown.ts`, which escapes HTML first and allows only safe link schemes.
- Dates entered by users are interpreted in the **server time zone** (`TZ`).

## Gotchas (each cost time before)

- **Windows + running dev server:** `prisma generate` can't replace `query_engine-windows.dll.node` (EPERM). The JS client still regenerates. Delete the leftover `.tmp*` file, copy `prisma/schema.prisma` into `node_modules/.prisma/client/`, and restart the dev server so it loads the new client.
- **`next build` with `NEXT_DIST_DIR` rewrites `tsconfig.json`** (adds `.next-verify/types` / `.next-e2e/types`). Revert it: `git checkout -- tsconfig.json`.
- **Prisma loads `.env` even in Vitest.** Tests that depend on an env var being unset must set it explicitly (see the LDAP test in `tests/phase9.integration.test.ts`).
- **Prisma refuses `migrate reset` / destructive commands when run by an AI agent.** Don't work around it; the e2e setup is intentionally non-destructive (`e2e/prepare.ts`).
- **ldapts switches to TLS whenever `tlsOptions` is passed, even for `ldap://`.** `ldapClient()` only passes it for `ldaps://`. StartTLS is opt-in via `LDAP_STARTTLS`.
- **Port 3389 is Windows Remote Desktop**, so the dev OpenLDAP runs on 1389.
- **CSP nonce** needs dynamic rendering. The root layout calls `headers()` so no page is prerendered. Never add inline `<script>`; inline `style=` is allowed.
- **Seed demo data is opt-in (`--demo`).** New seed blocks for demo data must start with `if (!DEMO) return;` so a production seed never inserts fictional records. Defaults that are useful in production (types, templates) belong outside that check.
- **Docker image:** only `.next`, `prisma`, `scripts`, `src/server/crypto` and `src/server/lib` are copied into the runtime stage. Anything `prisma/seed.ts` or `scripts/*` imports must be in those folders, or added to the Dockerfile.
- Integration tests share `itdocs_test` across runs and never clean it. Use unique names (`run = Date.now().toString(36)`) and don't assert global counts.

## Verifying in a browser

`.claude/launch.json` has `itdocs-dev` (:3000, dev mode) and `itdocs-verify` (:3001, serves a production build from `.next-verify`):

```bash
NEXT_DIST_DIR=.next-verify npx next build && git checkout -- tsconfig.json
```

Then start `itdocs-verify`. Sign in with the break-glass account from `.env` (`BOOTSTRAP_ADMIN_*`) or a dev LDAP user from `docker/ldap/seed.ldif`. Check the console for CSP violations.

## Layout

```
prisma/            schema.prisma, migrations/ (never edit an applied migration), seed.ts, seed-large.ts
src/middleware.ts  CSP nonce + session gate (API routes return 401 instead of redirecting)
src/instrumentation.ts, src/server/scheduler.ts   background jobs
src/server/
  modules/         business logic per area (RBAC + audit): assets, locations, people, vault, network, kb,
                   software, vendors, changes, incidents, journal, diagrams, relations, reports, alerts,
                   api-tokens, sync, search, settings, users, dashboard, audit-query, asset-import, asset-types
  lib/             pure helpers (+ storage, rate-limit)   api/   REST handler + serializers
  auth/            session, login (rate-limited), ldap     crypto/vault.ts   rbac/permissions.ts   audit/log.ts
src/app/(app)/     signed-in pages; each area has page.tsx, actions.ts, forms
src/app/api/       v1/ (token API), files/, reports/, search, lookup, health, exports
src/lib/           code shared with the browser (markdown, text-diff)
src/components/    shared UI (ui.tsx, form.tsx, pickers.tsx, …)
tests/             Vitest (*.test.ts unit, *.integration.test.ts against itdocs_test)
e2e/               Playwright specs (+ prepare.ts, auth.setup.ts)
scripts/           dev-db, start-verify, vault-rotate-key
docker/            Caddyfile, dev LDAP seed
```
