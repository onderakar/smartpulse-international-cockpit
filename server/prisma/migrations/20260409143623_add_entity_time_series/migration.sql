-- CreateTable
CREATE TABLE "EntityTimeSeries" (
    "id" SERIAL NOT NULL,
    "groupId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "seriesKey" TEXT NOT NULL,
    "deliveryStart" TIMESTAMP(3) NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "value" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL,
    "isFinal" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "EntityTimeSeries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EntityTimeSeries_groupId_entityType_entityId_seriesKey_isFi_idx" ON "EntityTimeSeries"("groupId", "entityType", "entityId", "seriesKey", "isFinal");

-- CreateIndex
CREATE INDEX "EntityTimeSeries_groupId_entityType_entityId_seriesKey_deli_idx" ON "EntityTimeSeries"("groupId", "entityType", "entityId", "seriesKey", "deliveryStart");

-- CreateIndex
CREATE INDEX "EntityTimeSeries_deliveryStart_idx" ON "EntityTimeSeries"("deliveryStart");
