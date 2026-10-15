/**
 * Runs the scheduler every five minutes: daily digest at the configured hour, scheduled report
 * emails, and daily AD / Intune syncs listed in SYNC_AUTO. Several app instances are fine: alerts
 * are deduplicated in the database and a sync refuses to start while another is running.
 * Set ALERTS_SCHEDULER=off to disable it, e.g. on a read replica.
 */
export function startScheduler() {
  if (process.env.ALERTS_SCHEDULER === "off") return;
  const g = globalThis as unknown as { __itdocsScheduler?: boolean };
  if (g.__itdocsScheduler) return; // dev hot-reload calls register() again
  g.__itdocsScheduler = true;
  const tick = async () => {
    try {
      const { runScheduled, SYSTEM_CTX } = await import("./modules/alerts");
      await runScheduled();
      const { sweep } = await import("./lib/rate-limit");
      await sweep();
      // Daily directory / device syncs listed in SYNC_AUTO (e.g. "ad,intune")
      if (process.env.SYNC_AUTO) {
        const { runAutoSyncs } = await import("./modules/sync");
        await runAutoSyncs(SYSTEM_CTX);
      }
    } catch (e) {
      console.error("[alerts] scheduled run failed:", e);
    }
  };
  setTimeout(tick, 60_000);
  setInterval(tick, 5 * 60_000).unref?.();
}
