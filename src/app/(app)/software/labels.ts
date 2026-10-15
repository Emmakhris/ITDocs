import type { LicenseModel, SeatBasis } from "@prisma/client";

export const LICENSE_MODEL: Record<LicenseModel, string> = { SUBSCRIPTION: "Subscription", PERPETUAL: "Perpetual" };
export const SEAT_BASIS: Record<SeatBasis, string> = { USER: "User", DEVICE: "Device", CONCURRENT: "Concurrent use", SITE: "Site (unlimited)" };
