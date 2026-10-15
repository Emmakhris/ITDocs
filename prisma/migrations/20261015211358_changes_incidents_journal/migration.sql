-- CreateEnum
CREATE TYPE "ChangeType" AS ENUM ('STANDARD', 'NORMAL', 'EMERGENCY');

-- CreateEnum
CREATE TYPE "ChangeRisk" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "ChangeStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'ROLLED_BACK', 'CANCELLED');

-- CreateEnum
CREATE TYPE "IncidentSeverity" AS ENUM ('P1', 'P2', 'P3', 'P4');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('OPEN', 'INVESTIGATING', 'MITIGATED', 'RESOLVED', 'CLOSED');

-- CreateTable
CREATE TABLE "ChangeRequest" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "type" "ChangeType" NOT NULL DEFAULT 'NORMAL',
    "risk" "ChangeRisk" NOT NULL DEFAULT 'MEDIUM',
    "status" "ChangeStatus" NOT NULL DEFAULT 'DRAFT',
    "impact" TEXT,
    "implementationPlan" TEXT NOT NULL DEFAULT '',
    "rollbackPlan" TEXT NOT NULL DEFAULT '',
    "testPlan" TEXT NOT NULL DEFAULT '',
    "plannedStart" TIMESTAMP(3),
    "plannedEnd" TIMESTAMP(3),
    "actualStart" TIMESTAMP(3),
    "actualEnd" TIMESTAMP(3),
    "requesterId" TEXT,
    "requesterName" TEXT NOT NULL,
    "approverId" TEXT,
    "approverName" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "outcomeNote" TEXT,
    "ticketRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Incident" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "severity" "IncidentSeverity" NOT NULL DEFAULT 'P3',
    "status" "IncidentStatus" NOT NULL DEFAULT 'OPEN',
    "impact" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mitigatedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "ownerId" TEXT,
    "causedByChangeId" TEXT,
    "rootCause" TEXT,
    "resolution" TEXT,
    "followUp" TEXT,
    "ticketRef" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentUpdate" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "authorId" TEXT,
    "authorName" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'note',
    "text" TEXT NOT NULL,

    CONSTRAINT "IncidentUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "authorId" TEXT,
    "authorName" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "tags" TEXT[],
    "onCall" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChangeRequest_number_key" ON "ChangeRequest"("number");

-- CreateIndex
CREATE INDEX "ChangeRequest_status_idx" ON "ChangeRequest"("status");

-- CreateIndex
CREATE INDEX "ChangeRequest_plannedStart_idx" ON "ChangeRequest"("plannedStart");

-- CreateIndex
CREATE INDEX "ChangeRequest_title_trgm" ON "ChangeRequest" USING GIN ("title" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "Incident_number_key" ON "Incident"("number");

-- CreateIndex
CREATE INDEX "Incident_status_severity_idx" ON "Incident"("status", "severity");

-- CreateIndex
CREATE INDEX "Incident_startedAt_idx" ON "Incident"("startedAt");

-- CreateIndex
CREATE INDEX "Incident_title_trgm" ON "Incident" USING GIN ("title" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "IncidentUpdate_incidentId_at_idx" ON "IncidentUpdate"("incidentId", "at");

-- CreateIndex
CREATE INDEX "JournalEntry_at_idx" ON "JournalEntry"("at");

-- CreateIndex
CREATE INDEX "JournalEntry_authorId_at_idx" ON "JournalEntry"("authorId", "at");

-- CreateIndex
CREATE INDEX "JournalEntry_tags_idx" ON "JournalEntry" USING GIN ("tags");

-- CreateIndex
CREATE INDEX "JournalEntry_text_trgm" ON "JournalEntry" USING GIN ("text" gin_trgm_ops);

-- AddForeignKey
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_causedByChangeId_fkey" FOREIGN KEY ("causedByChangeId") REFERENCES "ChangeRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentUpdate" ADD CONSTRAINT "IncidentUpdate_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentUpdate" ADD CONSTRAINT "IncidentUpdate_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Incident timelines are append-only: corrections are added as new entries
CREATE TRIGGER "IncidentUpdate_append_only" BEFORE UPDATE OR DELETE ON "IncidentUpdate"
  FOR EACH ROW EXECUTE FUNCTION itdocs_reject_change();
CREATE TRIGGER "IncidentUpdate_no_truncate" BEFORE TRUNCATE ON "IncidentUpdate"
  FOR EACH STATEMENT EXECUTE FUNCTION itdocs_reject_change();

-- A change window must end after it starts
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_window_order"
  CHECK ("plannedEnd" IS NULL OR "plannedStart" IS NULL OR "plannedEnd" > "plannedStart");
