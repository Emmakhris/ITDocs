import { describe, expect, it } from "vitest";
import { actionDate, contractState, licenseState, noticeBy, seatUsage } from "@/server/lib/renewals";

const now = new Date("2026-10-15T12:00:00Z");
const d = (days: number) => new Date(now.getTime() + days * 86_400_000);

describe("contract dates", () => {
  it("computes the notice deadline", () => {
    expect(noticeBy({ endDate: d(100), noticeDays: 90, autoRenew: true })?.toISOString()).toBe(d(10).toISOString());
    expect(noticeBy({ endDate: d(100), noticeDays: null, autoRenew: false })).toBeNull();
  });

  it("classifies contracts", () => {
    const s = (endDays: number | null, noticeDays: number | null = null) => contractState({ endDate: endDays === null ? null : d(endDays), noticeDays, autoRenew: false }, now).state;
    expect(s(null)).toBe("open");
    expect(s(-1)).toBe("expired");
    expect(s(30)).toBe("expiring");
    expect(s(300)).toBe("active");
    expect(s(150, 120)).toBe("notice-soon"); // notice due in 30 days
    expect(s(100, 120)).toBe("notice-passed"); // notice was due 20 days ago, still running
    expect(s(400, 30)).toBe("active");
  });

  it("points at the date someone must act on", () => {
    expect(actionDate({ endDate: d(150), noticeDays: 120, autoRenew: true }, now)?.toISOString()).toBe(d(30).toISOString());
    expect(actionDate({ endDate: d(100), noticeDays: 120, autoRenew: true }, now)?.toISOString()).toBe(d(100).toISOString());
  });
});

describe("licences", () => {
  it("classifies expiry", () => {
    expect(licenseState(null, now).state).toBe("open");
    expect(licenseState(d(-2), now)).toEqual({ state: "expired", daysLeft: -2 });
    expect(licenseState(d(45), now).state).toBe("expiring");
    expect(licenseState(d(365), now).state).toBe("active");
  });

  it("counts seats and over-allocation", () => {
    expect(seatUsage(10, 7)).toEqual({ used: 7, seats: 10, free: 3, over: 0 });
    expect(seatUsage(5, 8)).toEqual({ used: 8, seats: 5, free: 0, over: 3 });
    expect(seatUsage(null, 500)).toEqual({ used: 500, seats: null, free: null, over: 0 });
  });
});
