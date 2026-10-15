-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'TECHNICIAN', 'READONLY', 'AUDITOR');

-- CreateEnum
CREATE TYPE "AuthSource" AS ENUM ('LOCAL', 'LDAP');

-- CreateEnum
CREATE TYPE "LocationType" AS ENUM ('SITE', 'BUILDING', 'FLOOR', 'ROOM', 'AREA', 'RACK', 'STORAGE');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('ORDERED', 'IN_STOCK', 'DEPLOYED', 'IN_REPAIR', 'LOANED', 'RETIRED', 'DISPOSED', 'LOST');

-- CreateEnum
CREATE TYPE "MoveMethod" AS ENUM ('CREATE', 'MANUAL', 'SCAN', 'CHECKOUT', 'CHECKIN', 'IMPORT', 'BULK', 'DISPOSAL');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "email" TEXT,
    "role" "Role" NOT NULL DEFAULT 'READONLY',
    "source" "AuthSource" NOT NULL DEFAULT 'LDAP',
    "passwordHash" TEXT,
    "totpSecret" TEXT,
    "totpEnabled" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LdapGroupMapping" (
    "id" TEXT NOT NULL,
    "groupName" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "LdapGroupMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" BIGSERIAL NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "summary" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "costCenter" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Person" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "employeeId" TEXT,
    "phone" TEXT,
    "title" TEXT,
    "departmentId" TEXT,
    "adGuid" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LocationType" NOT NULL,
    "code" TEXT,
    "parentId" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "isMedical" BOOLEAN NOT NULL DEFAULT false,
    "fieldDefs" JSONB NOT NULL DEFAULT '[]',
    "tagPrefix" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "AssetType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "status" "AssetStatus" NOT NULL DEFAULT 'IN_STOCK',
    "manufacturer" TEXT,
    "model" TEXT,
    "serial" TEXT,
    "hostname" TEXT,
    "ipAddress" TEXT,
    "macAddress" TEXT,
    "os" TEXT,
    "locationId" TEXT,
    "assigneeId" TEXT,
    "departmentId" TEXT,
    "vendorName" TEXT,
    "purchaseDate" TIMESTAMP(3),
    "purchaseCost" DECIMAL(12,2),
    "poNumber" TEXT,
    "warrantyEnd" TIMESTAMP(3),
    "eolDate" TIMESTAMP(3),
    "udi" TEXT,
    "riskClass" TEXT,
    "biomedOwner" TEXT,
    "pmIntervalDays" INTEGER,
    "lastPmDate" TIMESTAMP(3),
    "nextPmDate" TIMESTAMP(3),
    "storesPhi" BOOLEAN NOT NULL DEFAULT false,
    "networkSegmented" BOOLEAN NOT NULL DEFAULT false,
    "customFields" JSONB NOT NULL DEFAULT '{}',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetMovement" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "movedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "movedById" TEXT,
    "movedByName" TEXT NOT NULL,
    "method" "MoveMethod" NOT NULL,
    "fromLocationId" TEXT,
    "toLocationId" TEXT,
    "fromLocationPath" TEXT,
    "toLocationPath" TEXT,
    "fromAssignee" TEXT,
    "toAssignee" TEXT,
    "fromStatus" "AssetStatus",
    "toStatus" "AssetStatus",
    "reason" TEXT,
    "ticketRef" TEXT,

    CONSTRAINT "AssetMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Checkout" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "checkedOutById" TEXT NOT NULL,
    "outAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "outCondition" TEXT,
    "inCondition" TEXT,
    "notes" TEXT,

    CONSTRAINT "Checkout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Disposal" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "disposedAt" TIMESTAMP(3) NOT NULL,
    "method" TEXT NOT NULL,
    "wipeMethod" TEXT,
    "certificateRef" TEXT,
    "vendor" TEXT,
    "witness" TEXT,
    "notes" TEXT,
    "recordedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Disposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntityLink" (
    "id" TEXT NOT NULL,
    "fromType" TEXT NOT NULL,
    "fromId" TEXT NOT NULL,
    "toType" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'related',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EntityLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),
    "dedupeKey" TEXT,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "LdapGroupMapping_groupName_key" ON "LdapGroupMapping"("groupName");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_at_idx" ON "AuditLog"("at");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- CreateIndex
CREATE UNIQUE INDEX "Department_name_key" ON "Department"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Person_employeeId_key" ON "Person"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "Person_adGuid_key" ON "Person"("adGuid");

-- CreateIndex
CREATE INDEX "Person_name_idx" ON "Person"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Location_code_key" ON "Location"("code");

-- CreateIndex
CREATE INDEX "Location_parentId_idx" ON "Location"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "AssetType_name_key" ON "AssetType"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_tag_key" ON "Asset"("tag");

-- CreateIndex
CREATE INDEX "Asset_status_idx" ON "Asset"("status");

-- CreateIndex
CREATE INDEX "Asset_locationId_idx" ON "Asset"("locationId");

-- CreateIndex
CREATE INDEX "Asset_assigneeId_idx" ON "Asset"("assigneeId");

-- CreateIndex
CREATE INDEX "Asset_typeId_idx" ON "Asset"("typeId");

-- CreateIndex
CREATE INDEX "Asset_serial_idx" ON "Asset"("serial");

-- CreateIndex
CREATE INDEX "Asset_hostname_idx" ON "Asset"("hostname");

-- CreateIndex
CREATE INDEX "Asset_warrantyEnd_idx" ON "Asset"("warrantyEnd");

-- CreateIndex
CREATE INDEX "Asset_nextPmDate_idx" ON "Asset"("nextPmDate");

-- CreateIndex
CREATE INDEX "AssetMovement_assetId_movedAt_idx" ON "AssetMovement"("assetId", "movedAt");

-- CreateIndex
CREATE INDEX "AssetMovement_toLocationId_idx" ON "AssetMovement"("toLocationId");

-- CreateIndex
CREATE INDEX "AssetMovement_movedAt_idx" ON "AssetMovement"("movedAt");

-- CreateIndex
CREATE INDEX "Checkout_assetId_idx" ON "Checkout"("assetId");

-- CreateIndex
CREATE INDEX "Checkout_returnedAt_dueAt_idx" ON "Checkout"("returnedAt", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "Disposal_assetId_key" ON "Disposal"("assetId");

-- CreateIndex
CREATE INDEX "EntityLink_toType_toId_idx" ON "EntityLink"("toType", "toId");

-- CreateIndex
CREATE UNIQUE INDEX "EntityLink_fromType_fromId_toType_toId_kind_key" ON "EntityLink"("fromType", "fromId", "toType", "toId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "Attachment_storageKey_key" ON "Attachment"("storageKey");

-- CreateIndex
CREATE INDEX "Attachment_entityType_entityId_idx" ON "Attachment"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Person" ADD CONSTRAINT "Person_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "AssetType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetMovement" ADD CONSTRAINT "AssetMovement_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetMovement" ADD CONSTRAINT "AssetMovement_movedById_fkey" FOREIGN KEY ("movedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetMovement" ADD CONSTRAINT "AssetMovement_fromLocationId_fkey" FOREIGN KEY ("fromLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetMovement" ADD CONSTRAINT "AssetMovement_toLocationId_fkey" FOREIGN KEY ("toLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Checkout" ADD CONSTRAINT "Checkout_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Checkout" ADD CONSTRAINT "Checkout_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Checkout" ADD CONSTRAINT "Checkout_checkedOutById_fkey" FOREIGN KEY ("checkedOutById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Disposal" ADD CONSTRAINT "Disposal_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Fuzzy search ──
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "Asset_search_trgm" ON "Asset" USING gin ((coalesce("tag",'') || ' ' || coalesce("name",'') || ' ' || coalesce("serial",'') || ' ' || coalesce("hostname",'') || ' ' || coalesce("model",'')) gin_trgm_ops);
CREATE INDEX "Location_name_trgm" ON "Location" USING gin ("name" gin_trgm_ops);
CREATE INDEX "Person_name_trgm" ON "Person" USING gin ("name" gin_trgm_ops);
CREATE INDEX "Asset_customFields_gin" ON "Asset" USING gin ("customFields");

-- ── Immutable history: audit log and asset movements cannot be changed or deleted ──
CREATE OR REPLACE FUNCTION itdocs_reject_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AuditLog_append_only" BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION itdocs_reject_change();
CREATE TRIGGER "AuditLog_no_truncate" BEFORE TRUNCATE ON "AuditLog"
  FOR EACH STATEMENT EXECUTE FUNCTION itdocs_reject_change();
CREATE TRIGGER "AssetMovement_append_only" BEFORE UPDATE OR DELETE ON "AssetMovement"
  FOR EACH ROW EXECUTE FUNCTION itdocs_reject_change();
