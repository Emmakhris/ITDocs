/**
 * Runs the alert scheduler every five minutes (daily digest at the configured hour, scheduled
 * report emails). Several app instances are fine: each alert is deduplicated in the database.
 * Set ALERTS_SCHEDULER=off to disable it, e.g. on a read replica.
 */
export function startScheduler() {
  if (process.env.ALERTS_SCHEDULER === "off") return;
  const g = globalThis as unknown as { __itdocsScheduler?: boolean };
  if (g.__itdocsScheduler) return; // dev hot-reload calls register() again
  g.__itdocsScheduler = true;
  const tick = async () => {
    try {
      const { runScheduled } = await import("./modules/alerts");
      await runScheduled();
    } catch (e) {
      console.error("[alerts] scheduled run failed:", e);
    }
  };
  setTimeout(tick, 60_000);
  setInterval(tick, 5 * 60_000).unref?.();
}
