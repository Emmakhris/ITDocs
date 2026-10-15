-- CreateEnum
CREATE TYPE "DiagramKind" AS ENUM ('NETWORK', 'FLOOR_PLAN', 'RACK', 'PROCESS', 'OTHER');

-- CreateEnum
CREATE TYPE "ReportFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "ReportFormat" AS ENUM ('CSV', 'XLSX');

-- CreateEnum
CREATE TYPE "AlertChannel" AS ENUM ('EMAIL', 'TEAMS');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('SENT', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "Diagram" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "kind" "DiagramKind" NOT NULL DEFAULT 'NETWORK',
    "locationId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Diagram_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportSubscription" (
    "id" TEXT NOT NULL,
    "reportKey" TEXT NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "frequency" "ReportFrequency" NOT NULL DEFAULT 'WEEKLY',
    "format" "ReportFormat" NOT NULL DEFAULT 'XLSX',
    "recipients" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSentAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertDelivery" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "channel" "AlertChannel" NOT NULL,
    "kind" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "recipients" TEXT,
    "status" "DeliveryStatus" NOT NULL,
    "error" TEXT,
    "dedupeKey" TEXT,

    CONSTRAINT "AlertDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Diagram_locationId_idx" ON "Diagram"("locationId");

-- CreateIndex
CREATE INDEX "ReportSubscription_active_nextRunAt_idx" ON "ReportSubscription"("active", "nextRunAt");

-- CreateIndex
CREATE INDEX "AlertDelivery_at_idx" ON "AlertDelivery"("at");

-- CreateIndex
CREATE UNIQUE INDEX "AlertDelivery_channel_dedupeKey_key" ON "AlertDelivery"("channel", "dedupeKey");

-- AddForeignKey
ALTER TABLE "Diagram" ADD CONSTRAINT "Diagram_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
