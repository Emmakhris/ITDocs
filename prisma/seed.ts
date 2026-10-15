/* Seed: break-glass admin, AD group mappings, asset types, and (if empty) demo data incl. network. Safe to re-run. */
import { PrismaClient, type LocationType, type AssetStatus } from "@prisma/client";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { aad, encrypt, vaultConfigured } from "../src/server/crypto/vault";

const db = new PrismaClient();

async function main() {
  // ── Break-glass admin ──
  const u = process.env.BOOTSTRAP_ADMIN_USERNAME?.toLowerCase();
  const p = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (u && p && !(await db.user.findUnique({ where: { username: u } }))) {
    await db.user.create({
      data: { username: u, displayName: "Break-glass Admin", role: "ADMIN", source: "LOCAL", passwordHash: await bcrypt.hash(p, 12) },
    });
    console.log(`Created break-glass admin "${u}"`);
  }

  // ── AD group → role mappings (edit in Admin › Directory) ──
  for (const [groupName, role, priority] of [
    ["IT-Admins", "ADMIN", 100],
    ["IT-Technicians", "TECHNICIAN", 50],
    ["IT-Auditors", "AUDITOR", 20],
    ["IT-ReadOnly", "READONLY", 10],
  ] as const) {
    await db.ldapGroupMapping.upsert({ where: { groupName }, create: { groupName, role, priority }, update: {} });
  }

  // ── Asset types with custom fields ──
  const types: { name: string; icon: string; isMedical?: boolean; tagPrefix?: string; fieldDefs: object[] }[] = [
    { name: "Laptop", icon: "laptop", fieldDefs: [
      { key: "cpu", label: "CPU", kind: "text", required: false },
      { key: "ram_gb", label: "RAM (GB)", kind: "number", required: false },
      { key: "encrypted", label: "Disk encrypted (BitLocker)", kind: "boolean", required: false },
    ] },
    { name: "Desktop", icon: "monitor", fieldDefs: [
      { key: "cpu", label: "CPU", kind: "text", required: false },
      { key: "ram_gb", label: "RAM (GB)", kind: "number", required: false },
    ] },
    { name: "Workstation on Wheels", icon: "monitor", fieldDefs: [
      { key: "battery_installed", label: "Battery installed", kind: "date", required: false },
    ] },
    { name: "Server", icon: "server", fieldDefs: [
      { key: "role", label: "Server role", kind: "text", required: false },
      { key: "virtual", label: "Virtual machine", kind: "boolean", required: false },
      { key: "backup_policy", label: "Backup policy", kind: "select", required: false, options: ["None", "Daily", "Hourly", "Continuous"] },
    ] },
    { name: "Network Switch", icon: "network", fieldDefs: [
      { key: "port_count", label: "Ports", kind: "number", required: false },
      { key: "firmware", label: "Firmware", kind: "text", required: false },
      { key: "mgmt_url", label: "Management URL", kind: "url", required: false },
    ] },
    { name: "Printer", icon: "printer", fieldDefs: [
      { key: "toner", label: "Toner model", kind: "text", required: false },
      { key: "queue", label: "Print queue", kind: "text", required: false },
    ] },
    { name: "Mobile Device", icon: "smartphone", fieldDefs: [
      { key: "imei", label: "IMEI", kind: "text", required: false },
      { key: "phone_number", label: "Phone number", kind: "text", required: false },
      { key: "mdm_enrolled", label: "MDM enrolled", kind: "boolean", required: false },
    ] },
    { name: "Infusion Pump", icon: "syringe", isMedical: true, tagPrefix: "BIO-", fieldDefs: [
      { key: "drug_library", label: "Drug library version", kind: "text", required: false },
      { key: "wireless", label: "Wireless enabled", kind: "boolean", required: false },
    ] },
    { name: "Patient Monitor", icon: "heart-pulse", isMedical: true, tagPrefix: "BIO-", fieldDefs: [
      { key: "central_station", label: "Central station", kind: "text", required: false },
    ] },
  ];
  for (const t of types) {
    await db.assetType.upsert({ where: { name: t.name }, create: t, update: {} });
  }

  if (await db.location.count()) {
    console.log("Locations exist — skipping demo data.");
    return;
  }

  // ── Demo locations ──
  const mk = (name: string, type: LocationType, parentId?: string, code?: string) =>
    db.location.create({ data: { name, type, parentId, code } });
  const campus = await mk("Main Campus", "SITE", undefined, "MAIN");
  const tower = await mk("Tower A", "BUILDING", campus.id, "TA");
  const f1 = await mk("Floor 1", "FLOOR", tower.id);
  const f3 = await mk("Floor 3", "FLOOR", tower.id);
  const er = await mk("Emergency Dept", "AREA", f1.id, "ED");
  const icu = await mk("ICU", "AREA", f3.id, "ICU");
  const mdf = await mk("MDF Server Room", "ROOM", f1.id, "MDF");
  const store = await mk("IT Storeroom", "STORAGE", f1.id, "ITSTORE");
  const clinic = await mk("Westside Clinic", "SITE", undefined, "WEST");
  const reception = await mk("Reception", "ROOM", clinic.id);
  const locs = [er, icu, mdf, store, reception];

  // ── Departments & people ──
  const depts = await Promise.all(
    ["Emergency Medicine", "Intensive Care", "Information Technology", "Finance", "Radiology"].map((name) =>
      db.department.create({ data: { name } }),
    ),
  );
  const names = ["Dr. Ama Mensah", "Kofi Boateng", "Sarah Johnson", "Michael Chen", "Grace Owusu", "Daniel Reyes", "Priya Patel", "Samuel Adjei"];
  const people = await Promise.all(
    names.map((name, i) =>
      db.person.create({
        data: {
          name,
          email: name.toLowerCase().replace(/^dr\. /, "").replace(/[^a-z]+/g, ".") + "@example.org",
          employeeId: `E${1000 + i}`,
          departmentId: depts[i % depts.length].id,
        },
      }),
    ),
  );

  // ── Demo assets ──
  const allTypes = await db.assetType.findMany();
  const T = (n: string) => allTypes.find((t) => t.name === n)!;
  const day = 86_400_000;
  const statuses: AssetStatus[] = ["DEPLOYED", "DEPLOYED", "DEPLOYED", "IN_STOCK", "IN_REPAIR"];
  const defs: { type: string; name: string; mf: string; model: string }[] = [
    { type: "Laptop", name: "Clinician Laptop", mf: "Dell", model: "Latitude 7450" },
    { type: "Desktop", name: "Nurse Station PC", mf: "HP", model: "EliteDesk 800 G9" },
    { type: "Workstation on Wheels", name: "WOW Cart", mf: "Capsa", model: "Trio" },
    { type: "Server", name: "Hypervisor Host", mf: "Dell", model: "PowerEdge R760" },
    { type: "Network Switch", name: "Access Switch", mf: "Cisco", model: "C9300-48P" },
    { type: "Printer", name: "Label Printer", mf: "Zebra", model: "ZD421" },
    { type: "Mobile Device", name: "Clinical Phone", mf: "Zebra", model: "TC52-HC" },
    { type: "Infusion Pump", name: "Infusion Pump", mf: "BD", model: "Alaris 8015" },
    { type: "Patient Monitor", name: "Bedside Monitor", mf: "Philips", model: "IntelliVue MX450" },
  ];
  let n = 0;
  for (let i = 0; i < 36; i++) {
    const d = defs[i % defs.length];
    const type = T(d.type);
    const clinical = [er, icu, reception];
    const loc = d.type === "Server" || d.type === "Network Switch" ? mdf : type.isMedical ? clinical[i % clinical.length] : locs[i % locs.length];
    const status = statuses[i % statuses.length];
    const person = d.type === "Laptop" || d.type === "Mobile Device" ? people[i % people.length] : null;
    const prefix = type.tagPrefix ?? "IT-";
    const tag = `${prefix}${String(++n).padStart(6, "0")}`;
    const created = new Date(Date.now() - (400 - i * 7) * day);
    const asset = await db.asset.create({
      data: {
        tag,
        name: `${d.name} ${String(i + 1).padStart(2, "0")}`,
        typeId: type.id,
        status,
        manufacturer: d.mf,
        model: d.model,
        serial: `SN${(100000 + i * 7919).toString(36).toUpperCase()}`,
        hostname: ["Laptop", "Desktop", "Server", "Workstation on Wheels"].includes(d.type) ? `HOSP-${d.type.slice(0, 3).toUpperCase()}-${100 + i}` : null,
        locationId: loc.id,
        assigneeId: person?.id,
        purchaseDate: created,
        purchaseCost: [1450, 980, 3200, 11800, 6400, 520, 890, 2600, 7100][i % 9],
        warrantyEnd: new Date(Date.now() + ((i * 23) % 400 - 30) * day),
        storesPhi: type.isMedical || d.type === "Workstation on Wheels",
        pmIntervalDays: type.isMedical ? 180 : null,
        lastPmDate: type.isMedical ? new Date(Date.now() - (150 + i) * day) : null,
        nextPmDate: type.isMedical ? new Date(Date.now() + (30 - i) * day) : null,
        riskClass: type.isMedical ? "Class II" : null,
        customFields: d.type === "Laptop" ? { cpu: "Intel Core Ultra 7", ram_gb: 16, encrypted: true } : {},
        createdAt: created,
      },
    });
    await db.assetMovement.create({
      data: {
        assetId: asset.id, method: "CREATE", movedByName: "seed", movedAt: created,
        toLocationId: store.id, toLocationPath: "Main Campus › Tower A › Floor 1 › IT Storeroom", toStatus: "IN_STOCK", reason: "Received from vendor",
      },
    });
    if (loc.id !== store.id || status !== "IN_STOCK") {
      const path = await pathOf(loc.id);
      await db.assetMovement.create({
        data: {
          assetId: asset.id, method: "MANUAL", movedByName: "seed", movedAt: new Date(created.getTime() + 5 * day),
          fromLocationId: store.id, fromLocationPath: "Main Campus › Tower A › Floor 1 › IT Storeroom", fromStatus: "IN_STOCK",
          toLocationId: loc.id, toLocationPath: path, toStatus: status, toAssignee: person?.name, reason: "Deployed", ticketRef: `INC${40000 + i}`,
        },
      });
    }
  }
  console.log(`Seeded demo data: ${n} assets, ${people.length} people, 10 locations.`);
}

async function pathOf(id: string) {
  const parts: string[] = [];
  let cur = await db.location.findUnique({ where: { id } });
  while (cur) {
    parts.unshift(cur.name);
    cur = cur.parentId ? await db.location.findUnique({ where: { id: cur.parentId } }) : null;
  }
  return parts.join(" › ");
}

/** Demo VLANs, subnets, a rack, switch ports and Wi-Fi — only when no network data exists yet. */
async function seedNetwork() {
  if (await db.vlan.count()) return;
  const main = await db.location.findUnique({ where: { code: "MAIN" } });
  const west = await db.location.findUnique({ where: { code: "WEST" } });
  const mdf = await db.location.findUnique({ where: { code: "MDF" } });
  if (!main || !mdf) return console.log("Demo locations missing — skipping network demo data.");

  const vlan = (number: number, name: string, purpose: string, locationId: string | null = main.id) =>
    db.vlan.create({ data: { number, name, purpose, locationId } });
  const mgmt = await vlan(10, "Management", "Switch, AP and iDRAC management. Admin workstations only.");
  const servers = await vlan(20, "Servers", "Data-centre servers and storage.");
  const clinical = await vlan(30, "Clinical workstations", "Nurse stations, WOWs and clinician laptops (wired).");
  const biomed = await vlan(40, "Biomed", "Infusion pumps and patient monitors — isolated, no internet.");
  const guest = await vlan(99, "Guest", "Patient & visitor Wi-Fi. Internet only, client isolation on.");
  const westData = west ? await vlan(30, "Clinic data", "All wired devices at Westside Clinic.", west.id) : null;

  const subnet = (cidr: string, name: string, vlanId: string, extra: { gateway?: string; dhcpStart?: string; dhcpEnd?: string; dns?: string; locationId?: string } = {}) =>
    db.subnet.create({ data: { cidr, name, vlanId, locationId: main.id, dns: "10.10.20.10, 10.10.20.11", ...extra } });
  const mgmtNet = await subnet("10.10.10.0/24", "Management", mgmt.id, { gateway: "10.10.10.1" });
  const srvNet = await subnet("10.10.20.0/24", "Servers", servers.id, { gateway: "10.10.20.1" });
  const clinNet = await subnet("10.10.32.0/22", "Clinical workstations", clinical.id, { gateway: "10.10.32.1", dhcpStart: "10.10.33.0", dhcpEnd: "10.10.35.200" });
  await subnet("10.10.40.0/24", "Biomed devices", biomed.id, { gateway: "10.10.40.1", dhcpStart: "10.10.40.100", dhcpEnd: "10.10.40.240" });
  await subnet("172.16.0.0/22", "Guest Wi-Fi", guest.id, { gateway: "172.16.0.1", dhcpStart: "172.16.0.10", dhcpEnd: "172.16.3.250", dns: "1.1.1.1, 9.9.9.9" });
  if (westData && west) await subnet("10.20.30.0/24", "Westside Clinic", westData.id, { gateway: "10.20.30.1", dhcpStart: "10.20.30.100", dhcpEnd: "10.20.30.200", locationId: west.id });

  await db.ipAddress.createMany({
    data: [
      { subnetId: srvNet.id, address: "10.10.20.10", status: "ASSIGNED", hostname: "dc01" },
      { subnetId: srvNet.id, address: "10.10.20.11", status: "ASSIGNED", hostname: "dc02" },
      { subnetId: srvNet.id, address: "10.10.20.50", status: "RESERVED", notes: "Future SAN controller" },
      { subnetId: clinNet.id, address: "10.10.32.20", status: "RESERVED", hostname: "ed-printer-01" },
    ],
  });

  // Hosts and switches in the MDF get addresses, rack positions and ports
  const assets = await db.asset.findMany({ where: { locationId: mdf.id, deletedAt: null }, include: { type: true }, orderBy: { tag: "asc" } });
  const hosts = assets.filter((a) => a.type.name === "Server");
  const switches = assets.filter((a) => a.type.name === "Network Switch");
  const rack = await db.rack.create({ data: { name: "MDF-R01", locationId: mdf.id, heightU: 42, notes: "Main distribution frame, Tower A floor 1. Dual PDUs on UPS-A/UPS-B." } });
  await db.rackMount.createMany({ data: [{ rackId: rack.id, label: "Patch panel A (1–48)", positionU: 42, heightU: 1 }, { rackId: rack.id, label: "Patch panel B (1–48)", positionU: 40, heightU: 1 }] });
  for (const [i, sw] of switches.entries()) {
    await db.rackMount.create({ data: { rackId: rack.id, assetId: sw.id, positionU: 38 - i, heightU: 1 } });
    await db.ipAddress.create({ data: { subnetId: mgmtNet.id, address: `10.10.10.${11 + i}`, status: "ASSIGNED", hostname: `sw-mdf-${i + 1}`, assetId: sw.id } });
    await db.switchPort.createMany({
      data: Array.from({ length: 48 }, (_, p) => ({
        switchId: sw.id,
        name: `Gi1/0/${p + 1}`,
        vlanId: p < 24 ? clinical.id : biomed.id,
        status: p < 6 ? ("ACTIVE" as const) : ("INACTIVE" as const),
        patchPanelPort: i === 0 ? `PP-A ${p + 1}` : null,
        wallJack: i === 0 && p < 6 ? `TA-1-${String(101 + p)}` : null,
      })),
    });
    await db.switchPort.create({ data: { switchId: sw.id, name: "Te1/1/1", mode: "TRUNK", allowedVlans: "10,20,30,40,99", description: "Uplink to core" } });
  }
  for (const [i, h] of hosts.entries()) {
    await db.rackMount.create({ data: { rackId: rack.id, assetId: h.id, positionU: 10 + i * 2, heightU: 2 } });
    await db.ipAddress.create({ data: { subnetId: srvNet.id, address: `10.10.20.${21 + i}`, status: "ASSIGNED", hostname: h.hostname, assetId: h.id } });
    if (switches[0]) await db.switchPort.updateMany({ where: { switchId: switches[0].id, name: `Gi1/0/${1 + i}` }, data: { connectedAssetId: h.id, vlanId: servers.id, description: `${h.hostname} NIC1` } });
  }

  await db.wifiNetwork.createMany({
    data: [
      { ssid: "HOSP-Clinical", auth: "WPA3_ENTERPRISE", vlanId: clinical.id, locationId: main.id, notes: "802.1X via NPS; machine + user certificates." },
      { ssid: "HOSP-Biomed", auth: "WPA2_PSK", vlanId: biomed.id, locationId: main.id, hidden: true, notes: "Pumps only support WPA2-PSK. Rotate the key with Biomed." },
      { ssid: "HOSP-Guest", auth: "OPEN", vlanId: guest.id, notes: "Captive portal on the firewall." },
    ],
  });
  console.log("Seeded network demo data: 6 VLANs, 6 subnets, 1 rack, switch ports, 3 Wi-Fi networks.");
}

/** KB categories, the standard templates and a few demo articles — only when the KB is empty. */
async function seedKb() {
  if (await db.article.count()) return;
  const cat = async (name: string, description: string) => db.kbCategory.upsert({ where: { name }, create: { name, description }, update: {} });
  const clinical = await cat("Clinical systems", "EHR, PACS, lab and medical-device procedures");
  const infra = await cat("Infrastructure", "Servers, network, storage, backups");
  const desk = await cat("Service desk", "How-tos for common tickets");
  await cat("Security", "Access, incidents, compliance");

  const DAY = 86_400_000;
  const article = async (title: string, body: string, o: { categoryId?: string; tags?: string[]; isTemplate?: boolean; status?: "DRAFT" | "PUBLISHED"; reviewEveryDays?: number; links?: { toType: string; toId: string }[] } = {}) => {
    const a = await db.article.create({
      data: {
        title, body, categoryId: o.categoryId, tags: o.tags ?? [], isTemplate: !!o.isTemplate, status: o.isTemplate ? "PUBLISHED" : (o.status ?? "PUBLISHED"),
        reviewEveryDays: o.reviewEveryDays, reviewDueAt: o.reviewEveryDays ? new Date(Date.now() + o.reviewEveryDays * DAY) : null,
        createdBy: "seed", updatedBy: "seed",
      },
    });
    await db.articleVersion.create({ data: { articleId: a.id, version: 1, title, body, changeNote: "Created", editedByName: "seed" } });
    for (const l of o.links ?? []) await db.entityLink.create({ data: { fromType: "Article", fromId: a.id, toType: l.toType, toId: l.toId, kind: "documents" } });
    return a;
  };

  // ── Templates ──
  await article("Standard operating procedure (SOP)", `## Purpose
Why this procedure exists and when to use it.

## Scope
Systems, sites and people this applies to.

## Roles
| Role | Responsibility |
|---|---|
| Technician | |
| Approver | |

## Procedure
1. Step one
2. Step two

## Verification
- [ ] How to confirm it worked

## References
- Related articles, vendor docs`, { isTemplate: true, tags: ["sop"] });
  await article("Runbook", `> [!NOTE] Use this runbook when …

## Symptoms
What users or monitoring report.

## Diagnosis
1. Check …

## Fix
1. …

## Escalation
| When | Who | Contact |
|---|---|---|
| Not fixed in 30 min | On-call engineer | |

## Rollback
How to undo the change safely.`, { isTemplate: true, tags: ["runbook"] });
  await article("New starter onboarding", `## Before day one
- [ ] AD account created and added to role groups
- [ ] Email and Teams licence assigned
- [ ] Device allocated and tagged (record the asset tag)

## Day one
- [ ] Badge photo and access card
- [ ] EHR training booked
- [ ] Password and MFA set up in person

## Notes
`, { isTemplate: true, tags: ["onboarding"] });
  await article("Downtime procedure", `> [!WARNING] Follow the hospital incident-command instructions first.

## Trigger
When to declare downtime.

## Communication
- Notify the service desk and the on-call manager
- Post on the status page

## During downtime
1. Switch to paper forms (location: …)
2. …

## Recovery
1. Back-entry of paper records
2. Confirm interfaces are flowing`, { isTemplate: true, tags: ["downtime"] });

  // ── Demo articles ──
  const ed = await db.location.findUnique({ where: { code: "ED" } });
  const mdf = await db.location.findUnique({ where: { code: "MDF" } });
  const printers = await db.asset.findMany({ where: { type: { name: "Printer" }, deletedAt: null }, select: { id: true }, take: 3 });
  const hosts = await db.asset.findMany({ where: { type: { name: "Server" }, deletedAt: null }, select: { id: true }, take: 2 });

  await article("EHR downtime procedure — Emergency Dept", `> [!WARNING] Call the service desk on **x2210** before starting. Downtime is declared by the duty manager only.

## When to use
The EHR is unavailable for more than **15 minutes** in the Emergency Department.

## Steps
1. Open the red downtime box at the nurse station (shelf under the label printer).
2. Print the latest census from the downtime PC \`ED-DT-01\` — it holds a read-only copy refreshed every 15 minutes.
3. Use paper triage and medication forms; record the time on every sheet.
4. Every hour, check the status page: https://status.example.org

## Recovery
- [ ] EHR back up and confirmed by the service desk
- [ ] Back-enter paper records within 24 hours
- [ ] Return the downtime box to the nurse station and restock forms`, { categoryId: clinical.id, tags: ["ehr", "downtime", "emergency"], reviewEveryDays: 180, links: ed ? [{ toType: "Location", toId: ed.id }] : [] });

  await article("Zebra label printer: clear a label jam", `## Symptoms
Labels feed crooked, or the status light flashes **red**.

## Fix
1. Open the lid and remove the label roll.
2. Peel any stuck labels off the platen roller — never use a blade.
3. Reload the roll **label side up**, guiding it under the media guides.
4. Hold the feed button for 2 seconds to calibrate.

> [!TIP] If labels still skip, clean the print head with an alcohol swab and let it dry for 1 minute.`, { categoryId: desk.id, tags: ["printer", "zebra"], links: printers.map((p) => ({ toType: "Asset", toId: p.id })) });

  await article("Hypervisor host patching", `## Before you start
- Change ticket approved (CAB)
- Maintenance window: Sunday 02:00–05:00

## Procedure
1. Put the host into maintenance mode; wait for VMs to migrate.
2. Apply the vendor bundle.
3. Reboot and check iDRAC for hardware alerts.
4. Exit maintenance mode.

| Host | iDRAC | Order |
|---|---|---|
| HOSP-SER-103 | 10.10.10.103 | 1 |
| HOSP-SER-112 | 10.10.10.112 | 2 |`, { categoryId: infra.id, tags: ["vmware", "patching"], reviewEveryDays: 365, links: [...hosts.map((h) => ({ toType: "Asset", toId: h.id })), ...(mdf ? [{ toType: "Location", toId: mdf.id }] : [])] });

  await article("Wi-Fi: connecting a new infusion pump", `Draft — waiting for Biomed to confirm the drug-library step.

1. Join SSID **HOSP-Biomed** (key in the vault: *Biomed Wi-Fi PSK*).
2. Record the MAC address in the asset record.`, { categoryId: clinical.id, tags: ["biomed", "wifi"], status: "DRAFT" });

  console.log("Seeded knowledge base: 4 categories, 4 templates, 4 articles.");
}

/** Vendors, contracts, software and licences — only when no vendors exist yet. */
async function seedVendors() {
  if (await db.vendor.count()) return;
  const DAY = 86_400_000;
  const at = (days: number) => new Date(Date.now() + days * DAY);
  const vendor = (name: string, extra: Record<string, string> = {}) => db.vendor.create({ data: { name, ...extra } });
  const dell = await vendor("Dell Technologies", { website: "https://www.dell.com", supportPhone: "+1 800 456 3355", supportUrl: "https://www.dell.com/support", accountNumber: "DL-448201" });
  const cisco = await vendor("Cisco", { website: "https://www.cisco.com", supportPhone: "+1 800 553 2447", supportUrl: "https://mycase.cloudapps.cisco.com" });
  const bd = await vendor("BD (Becton Dickinson)", { supportPhone: "+1 888 812 3266", supportEmail: "support@example.org", accountNumber: "BD-77310" });
  const microsoft = await vendor("Microsoft", { website: "https://www.microsoft.com", supportUrl: "https://admin.microsoft.com" });
  const zebra = await vendor("Zebra Technologies", { supportPhone: "+1 800 653 5350", supportUrl: "https://www.zebra.com/support" });
  await db.vendorContact.createMany({
    data: [
      { vendorId: dell.id, name: "Alex Rivera", role: "Account manager", email: "alex.rivera@example.org", phone: "+1 555 0101" },
      { vendorId: cisco.id, name: "Priya Shah", role: "Partner engineer", email: "priya.shah@example.org" },
      { vendorId: bd.id, name: "Biomed field service", role: "Field service desk", phone: "+1 555 0177", notes: "Quote the account number" },
    ],
  });

  const contract = (data: Parameters<typeof db.contract.create>[0]["data"]) => db.contract.create({ data });
  const prosupport = await contract({ vendorId: dell.id, title: "ProSupport Plus — servers", type: "SUPPORT", reference: "PSP-2025-1182", startDate: at(-250), endDate: at(115), noticeDays: 90, autoRenew: true, annualCost: 18400, sla: "4h mission-critical onsite, 24×7" });
  await contract({ vendorId: cisco.id, title: "Smart Net Total Care — access switches", type: "MAINTENANCE", reference: "SNTC-90331", startDate: at(-320), endDate: at(45), noticeDays: 30, annualCost: 9600, sla: "Next-business-day parts" });
  const pumps = await contract({ vendorId: bd.id, title: "Alaris pump service agreement", type: "SERVICE", reference: "BD-SA-5521", startDate: at(-100), endDate: at(630), noticeDays: 120, annualCost: 32000, sla: "Annual PM + repairs, 5 working days" });
  await contract({ vendorId: zebra.id, title: "Label printer OneCare", type: "SUPPORT", startDate: at(-400), endDate: at(-12), annualCost: 1200 });
  const m365 = await contract({ vendorId: microsoft.id, title: "Enterprise Agreement", type: "SUBSCRIPTION", reference: "EA-6610042", startDate: at(-700), endDate: at(395), noticeDays: 60, autoRenew: false, annualCost: 214000 });

  const cover = async (contractId: string, typeName: string) => {
    const assets = await db.asset.findMany({ where: { type: { name: typeName }, deletedAt: null }, select: { id: true } });
    for (const a of assets) await db.entityLink.create({ data: { fromType: "Contract", fromId: contractId, toType: "Asset", toId: a.id, kind: "covers" } });
  };
  await cover(prosupport.id, "Server");
  await cover(pumps.id, "Infusion Pump");

  const software = (name: string, vendorId: string, category: string) => db.software.create({ data: { name, vendorId, category } });
  const office = await software("Microsoft 365 E3", microsoft.id, "Productivity");
  const defender = await software("Microsoft Defender for Endpoint", microsoft.id, "Security");
  const labels = await software("Zebra Designer Pro", zebra.id, "Utilities");
  const key = (id: string, k: string) => (vaultConfigured() ? encrypt(k, aad.license(id)) : null);
  const license = async (data: Omit<Parameters<typeof db.license.create>[0]["data"], "id">, plainKey?: string) => {
    const id = crypto.randomUUID();
    return db.license.create({ data: { ...data, id, keyEnc: plainKey ? key(id, plainKey) : null } as Parameters<typeof db.license.create>[0]["data"] });
  };
  const e3 = await license({ softwareId: office.id, name: "EA 2025–2027", model: "SUBSCRIPTION", seatBasis: "USER", seats: 8, vendorId: microsoft.id, contractId: m365.id, expiresAt: m365.endDate, poNumber: "PO-24-0912" });
  const mde = await license({ softwareId: defender.id, name: "EA add-on", model: "SUBSCRIPTION", seatBasis: "DEVICE", seats: 30, vendorId: microsoft.id, contractId: m365.id, expiresAt: m365.endDate });
  const zd = await license({ softwareId: labels.id, name: "Perpetual — 3 seats", model: "PERPETUAL", seatBasis: "DEVICE", seats: 3, vendorId: zebra.id, purchaseDate: at(-900), cost: 1350 }, "ZD-PRO-4F7Q-91KD-22XM");

  const people = await db.person.findMany({ where: { deletedAt: null }, select: { id: true }, take: 8 });
  for (const p of people) await db.licenseAssignment.create({ data: { licenseId: e3.id, personId: p.id, assignedBy: "seed" } });
  const devices = await db.asset.findMany({ where: { deletedAt: null, type: { name: { in: ["Laptop", "Desktop", "Workstation on Wheels", "Server"] } } }, select: { id: true } });
  for (const d of devices) await db.licenseAssignment.create({ data: { licenseId: mde.id, assetId: d.id, assignedBy: "seed" } });
  // One seat too many on the label software, so the over-allocation warning has something to show
  const pcs = await db.asset.findMany({ where: { deletedAt: null, type: { name: "Desktop" } }, select: { id: true }, take: 4 });
  for (const d of pcs) await db.licenseAssignment.create({ data: { licenseId: zd.id, assetId: d.id, assignedBy: "seed" } });

  console.log("Seeded vendors & software: 5 vendors, 5 contracts, 3 software titles, 3 licences.");
}

main()
  .then(seedNetwork)
  .then(seedKb)
  .then(seedVendors)
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
