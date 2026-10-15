import { defineConfig } from "vitest/config";
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
    },
  },
});
