/* Seed: break-glass admin, AD group mappings, asset types, and (if empty) demo data. Safe to re-run. */
import { PrismaClient, type LocationType, type AssetStatus } from "@prisma/client";
import bcrypt from "bcryptjs";

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

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
