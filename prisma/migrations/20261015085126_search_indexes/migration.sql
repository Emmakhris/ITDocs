-- DropIndex
DROP INDEX "Asset_customFields_gin";

-- CreateIndex
CREATE INDEX "Asset_name_trgm" ON "Asset" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Asset_tag_trgm" ON "Asset" USING GIN ("tag" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Asset_serial_trgm" ON "Asset" USING GIN ("serial" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Asset_hostname_trgm" ON "Asset" USING GIN ("hostname" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Asset_customFields_gin" ON "Asset" USING GIN ("customFields" jsonb_path_ops);

-- Replaced by per-column trigram indexes
DROP INDEX IF EXISTS "Asset_search_trgm";
