-- CreateEnum
CREATE TYPE "IpStatus" AS ENUM ('FREE', 'RESERVED', 'ASSIGNED', 'DHCP');

-- CreateEnum
CREATE TYPE "PortMode" AS ENUM ('ACCESS', 'TRUNK');

-- CreateEnum
CREATE TYPE "PortStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'DISABLED', 'FAULTY');

-- CreateEnum
CREATE TYPE "WifiAuth" AS ENUM ('OPEN', 'WPA2_PSK', 'WPA3_SAE', 'WPA2_ENTERPRISE', 'WPA3_ENTERPRISE');

-- CreateTable
CREATE TABLE "Vlan" (
    "id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "locationId" TEXT,
    "purpose" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subnet" (
    "id" TEXT NOT NULL,
    "cidr" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "vlanId" TEXT,
    "locationId" TEXT,
    "gateway" TEXT,
    "dhcpStart" TEXT,
    "dhcpEnd" TEXT,
    "dns" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subnet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IpAddress" (
    "id" TEXT NOT NULL,
    "subnetId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "status" "IpStatus" NOT NULL DEFAULT 'ASSIGNED',
    "hostname" TEXT,
    "macAddress" TEXT,
    "assetId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IpAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rack" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "locationId" TEXT,
    "heightU" INTEGER NOT NULL DEFAULT 42,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RackMount" (
    "id" TEXT NOT NULL,
    "rackId" TEXT NOT NULL,
    "assetId" TEXT,
    "label" TEXT,
    "positionU" INTEGER NOT NULL,
    "heightU" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RackMount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SwitchPort" (
    "id" TEXT NOT NULL,
    "switchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "connectedAssetId" TEXT,
    "patchPanelPort" TEXT,
    "wallJack" TEXT,
    "vlanId" TEXT,
    "mode" "PortMode" NOT NULL DEFAULT 'ACCESS',
    "allowedVlans" TEXT,
    "status" "PortStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SwitchPort_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WifiNetwork" (
    "id" TEXT NOT NULL,
    "ssid" TEXT NOT NULL,
    "auth" "WifiAuth" NOT NULL DEFAULT 'WPA2_ENTERPRISE',
    "vlanId" TEXT,
    "credentialId" TEXT,
    "locationId" TEXT,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WifiNetwork_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Vlan_number_idx" ON "Vlan"("number");

-- CreateIndex
CREATE UNIQUE INDEX "Vlan_locationId_number_key" ON "Vlan"("locationId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Subnet_cidr_key" ON "Subnet"("cidr");

-- CreateIndex
CREATE INDEX "Subnet_vlanId_idx" ON "Subnet"("vlanId");

-- CreateIndex
CREATE INDEX "Subnet_name_trgm" ON "Subnet" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "IpAddress_address_idx" ON "IpAddress"("address");

-- CreateIndex
CREATE INDEX "IpAddress_assetId_idx" ON "IpAddress"("assetId");

-- CreateIndex
CREATE INDEX "IpAddress_hostname_idx" ON "IpAddress"("hostname");

-- CreateIndex
CREATE UNIQUE INDEX "IpAddress_subnetId_address_key" ON "IpAddress"("subnetId", "address");

-- CreateIndex
CREATE INDEX "Rack_locationId_idx" ON "Rack"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "RackMount_assetId_key" ON "RackMount"("assetId");

-- CreateIndex
CREATE INDEX "RackMount_rackId_idx" ON "RackMount"("rackId");

-- CreateIndex
CREATE INDEX "SwitchPort_connectedAssetId_idx" ON "SwitchPort"("connectedAssetId");

-- CreateIndex
CREATE INDEX "SwitchPort_wallJack_idx" ON "SwitchPort"("wallJack");

-- CreateIndex
CREATE UNIQUE INDEX "SwitchPort_switchId_name_key" ON "SwitchPort"("switchId", "name");

-- CreateIndex
CREATE INDEX "WifiNetwork_ssid_idx" ON "WifiNetwork"("ssid");

-- AddForeignKey
ALTER TABLE "Vlan" ADD CONSTRAINT "Vlan_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subnet" ADD CONSTRAINT "Subnet_vlanId_fkey" FOREIGN KEY ("vlanId") REFERENCES "Vlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subnet" ADD CONSTRAINT "Subnet_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IpAddress" ADD CONSTRAINT "IpAddress_subnetId_fkey" FOREIGN KEY ("subnetId") REFERENCES "Subnet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IpAddress" ADD CONSTRAINT "IpAddress_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rack" ADD CONSTRAINT "Rack_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RackMount" ADD CONSTRAINT "RackMount_rackId_fkey" FOREIGN KEY ("rackId") REFERENCES "Rack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RackMount" ADD CONSTRAINT "RackMount_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SwitchPort" ADD CONSTRAINT "SwitchPort_switchId_fkey" FOREIGN KEY ("switchId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SwitchPort" ADD CONSTRAINT "SwitchPort_connectedAssetId_fkey" FOREIGN KEY ("connectedAssetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SwitchPort" ADD CONSTRAINT "SwitchPort_vlanId_fkey" FOREIGN KEY ("vlanId") REFERENCES "Vlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WifiNetwork" ADD CONSTRAINT "WifiNetwork_vlanId_fkey" FOREIGN KEY ("vlanId") REFERENCES "Vlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WifiNetwork" ADD CONSTRAINT "WifiNetwork_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "Credential"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WifiNetwork" ADD CONSTRAINT "WifiNetwork_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
