import type { ContractType } from "@prisma/client";

export const CONTRACT_TYPE: Record<ContractType, string> = {
  SUPPORT: "Support",
  MAINTENANCE: "Maintenance",
  WARRANTY: "Extended warranty",
  LEASE: "Lease",
  SUBSCRIPTION: "Subscription",
  SERVICE: "Service / SLA",
  OTHER: "Other",
};
