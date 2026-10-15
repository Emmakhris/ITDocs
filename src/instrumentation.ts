/**
 * Next.js calls register() once when the server starts. On the Node.js runtime it starts the
 * alert scheduler (src/server/scheduler.ts). The NEXT_RUNTIME check must stay in this exact form
 * so the bundler drops the Node-only import from the edge build.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("./server/scheduler");
    startScheduler();
  }
}
