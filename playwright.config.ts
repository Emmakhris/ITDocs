import { defineConfig, devices } from "@playwright/test";
import os from "node:os";
import path from "node:path";

// End-to-end tests: a production build on :3100 against its own database (itdocs_e2e), migrated and
// seeded by e2e/prepare.ts (non-destructive). Run with `npm run test:e2e`. Everything here is
// test-only: the database, the admin password and the vault key are never used outside this suite.

export const E2E = {
  port: 3100,
  databaseUrl: process.env.E2E_DATABASE_URL ?? "postgresql://itdocs:itdocs@localhost:5433/itdocs_e2e",
  admin: { username: "e2e-admin", password: "E2e-Only-Passw0rd!" },
};

const env = {
  DATABASE_URL: E2E.databaseUrl,
  BOOTSTRAP_ADMIN_USERNAME: E2E.admin.username,
  BOOTSTRAP_ADMIN_PASSWORD: E2E.admin.password,
  VAULT_MASTER_KEY: "ZTJlLW9ubHktdmF1bHQta2V5LTMyLWJ5dGVzLWxvbmc=", // 32 bytes, test-only
  VAULT_OLD_MASTER_KEYS: "",
  COOKIE_SECURE: "false",
  APP_URL: `http://localhost:${E2E.port}`,
  LDAP_ENABLED: "false",
  SMTP_HOST: "log",
  TEAMS_WEBHOOK_URL: "",
  ALERTS_SCHEDULER: "off",
  SYNC_AUTO: "",
  UPLOAD_DIR: path.join(os.tmpdir(), "itdocs-e2e-uploads"),
  NEXT_DIST_DIR: ".next-e2e",
  NODE_ENV: "production" as const,
};

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  timeout: 45_000,
  use: {
    baseURL: `http://localhost:${E2E.port}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    { name: "chromium", use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/admin.json" }, dependencies: ["setup"], testIgnore: /auth\.setup\.ts/ },
  ],
  webServer: {
    // Reset + seed the e2e database, build, then serve
    command: `npx tsx e2e/prepare.ts && npx next build && npx next start -p ${E2E.port}`,
    url: `http://localhost:${E2E.port}/api/health`,
    reuseExistingServer: false,
    timeout: 300_000,
    env,
    stdout: "pipe",
  },
});

