import type { Module } from "@/server/rbac/permissions";

export type NavItem = { href: string; label: string; icon: string; module: Module; phase?: number };
export type NavGroup = { label: string; items: NavItem[] };

/** Sidebar structure. Items with `phase` are on the roadmap and show a "planned" page. */
export const NAV: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: "layout-dashboard", module: "assets" },
      { href: "/scan", label: "Scan", icon: "scan-line", module: "assets" },
    ],
  },
  {
    label: "Inventory",
    items: [
      { href: "/assets", label: "Assets", icon: "boxes", module: "assets" },
      { href: "/movements", label: "Movement log", icon: "route", module: "assets" },
      { href: "/checkouts", label: "Check-outs", icon: "arrow-left-right", module: "assets" },
      { href: "/locations", label: "Locations", icon: "map-pin", module: "locations" },
      { href: "/people", label: "People", icon: "users", module: "people" },
    ],
  },
  {
    label: "Documentation",
    items: [
      { href: "/vault", label: "Password vault", icon: "key-round", module: "vault" },
      { href: "/network", label: "Network", icon: "network", module: "network" },
      { href: "/kb", label: "Knowledge base", icon: "book-open", module: "kb", phase: 5 },
      { href: "/software", label: "Software & licenses", icon: "app-window", module: "software", phase: 6 },
      { href: "/vendors", label: "Vendors & contracts", icon: "handshake", module: "vendors", phase: 6 },
      { href: "/changes", label: "Changes & incidents", icon: "git-pull-request", module: "changes", phase: 7 },
      { href: "/diagrams", label: "Diagrams", icon: "share-2", module: "network", phase: 8 },
    ],
  },
  {
    label: "Governance",
    items: [
      { href: "/reports", label: "Reports", icon: "bar-chart-3", module: "reports", phase: 8 },
      { href: "/audit", label: "Audit log", icon: "shield-check", module: "audit" },
      { href: "/admin", label: "Administration", icon: "settings", module: "admin" },
    ],
  },
];
