/** Contract and licence date rules, shared by lists, detail pages, the dashboard and the renewals view. */

const DAY = 86_400_000;
export const SOON_DAYS = 60;

export type RenewalState = "open" | "active" | "notice-soon" | "notice-passed" | "expiring" | "expired";

export type ContractDates = { endDate: Date | null; noticeDays: number | null; autoRenew: boolean };

/** Last day to give notice (cancel / renegotiate) before the contract ends, if a notice period is set. */
export function noticeBy(c: ContractDates): Date | null {
  return c.endDate && c.noticeDays ? new Date(c.endDate.getTime() - c.noticeDays * DAY) : null;
}

const daysBetween = (from: Date, to: Date) => Math.ceil((to.getTime() - from.getTime()) / DAY);

/**
 * Where a contract stands today. "notice-passed" means the notice deadline has gone by while the
 * contract is still running — for an auto-renewing contract it will now renew for another term.
 */
export function contractState(c: ContractDates, now = new Date()): { state: RenewalState; daysLeft: number | null; noticeBy: Date | null } {
  const nb = noticeBy(c);
  if (!c.endDate) return { state: "open", daysLeft: null, noticeBy: null };
  const daysLeft = daysBetween(now, c.endDate);
  if (daysLeft < 0) return { state: "expired", daysLeft, noticeBy: nb };
  if (nb) {
    const toNotice = daysBetween(now, nb);
    if (toNotice < 0) return { state: "notice-passed", daysLeft, noticeBy: nb };
    if (toNotice <= SOON_DAYS) return { state: "notice-soon", daysLeft, noticeBy: nb };
  }
  if (daysLeft <= SOON_DAYS) return { state: "expiring", daysLeft, noticeBy: nb };
  return { state: "active", daysLeft, noticeBy: nb };
}

/** The date someone has to act on: the notice deadline if there is one still ahead, else the end date. */
export function actionDate(c: ContractDates, now = new Date()): Date | null {
  const nb = noticeBy(c);
  return nb && nb.getTime() >= now.getTime() ? nb : c.endDate;
}

export function licenseState(expiresAt: Date | null, now = new Date()): { state: "open" | "active" | "expiring" | "expired"; daysLeft: number | null } {
  if (!expiresAt) return { state: "open", daysLeft: null };
  const daysLeft = daysBetween(now, expiresAt);
  return { state: daysLeft < 0 ? "expired" : daysLeft <= SOON_DAYS ? "expiring" : "active", daysLeft };
}

/** Seat usage; `seats` null means unlimited (site licence). */
export function seatUsage(seats: number | null, used: number) {
  if (seats === null) return { used, seats: null, free: null, over: 0 };
  return { used, seats, free: Math.max(0, seats - used), over: Math.max(0, used - seats) };
}
