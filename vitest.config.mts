import { defineConfig } from "vitest/config";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Integration tests run against a separate database: TEST_DATABASE_URL (default: itdocs_test on the dev server).
// Create it once with:  DATABASE_URL=<test url> npx prisma migrate deploy
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "server-only": path.resolve(__dirname, "tests/stubs/empty.ts"),
      "next/headers": path.resolve(__dirname, "tests/stubs/next-headers.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgresql://itdocs:itdocs@localhost:5433/itdocs_test",
      // Fixed, test-only vault key (32 bytes) — never used outside the test database
      VAULT_MASTER_KEY: "dGVzdC1vbmx5LXZhdWx0LWtleS0zMi1ieXRlcyEhISE=",
      VAULT_OLD_MASTER_KEYS: "",
      // Attachment uploads from tests go to the OS temp folder, not ./data
      UPLOAD_DIR: path.join(os.tmpdir(), "itdocs-test-uploads"),
      // Email goes to the delivery log only; Teams is off unless a test sets it
      SMTP_HOST: "log",
      TEAMS_WEBHOOK_URL: "",
      APP_URL: "https://itdocs.test",
    },
  },
});
