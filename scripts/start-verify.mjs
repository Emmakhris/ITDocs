// Serves a build made with NEXT_DIST_DIR=.next-verify on port 3001, alongside a server on :3000.
import { spawn } from "node:child_process";
spawn(process.platform === "win32" ? "npx.cmd" : "npx", ["next", "start", "-p", "3001"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, NEXT_DIST_DIR: ".next-verify" },
}).on("exit", (c) => process.exit(c ?? 0));
