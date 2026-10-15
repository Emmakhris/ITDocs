import type { IpStatus, PortMode, PortStatus, WifiAuth } from "@prisma/client";

type Tone = "gray" | "blue" | "green" | "amber" | "red";

export const IP_STATUS: Record<IpStatus, { label: string; tone: Tone }> = {
  ASSIGNED: { label: "Assigned (static)", tone: "green" },
  RESERVED: { label: "Reserved", tone: "amber" },
  DHCP: { label: "DHCP reservation", tone: "blue" },
  FREE: { label: "Free (note only)", tone: "gray" },
};

export const PORT_STATUS: Record<PortStatus, { label: string; tone: Tone }> = {
  ACTIVE: { label: "Active", tone: "green" },
  INACTIVE: { label: "Not connected", tone: "gray" },
  DISABLED: { label: "Disabled", tone: "amber" },
  FAULTY: { label: "Faulty", tone: "red" },
};

export const PORT_MODE: Record<PortMode, string> = { ACCESS: "Access", TRUNK: "Trunk" };

export const WIFI_AUTH: Record<WifiAuth, string> = {
  OPEN: "Open",
  WPA2_PSK: "WPA2-Personal (PSK)",
  WPA3_SAE: "WPA3-Personal (SAE)",
  WPA2_ENTERPRISE: "WPA2-Enterprise (802.1X)",
  WPA3_ENTERPRISE: "WPA3-Enterprise (802.1X)",
};

export const TABS = [
  { key: "subnets", label: "Subnets & IPs" },
  { key: "vlans", label: "VLANs" },
  { key: "racks", label: "Racks" },
  { key: "ports", label: "Switch ports" },
  { key: "wifi", label: "Wi-Fi" },
] as const;
export type TabKey = (typeof TABS)[number]["key"];
