-- CreateTable
CREATE TABLE "Asset" (
    "id" SERIAL NOT NULL,
    "parentId" INTEGER,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "portalCompanyId" INTEGER,
    "portalGroupId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataSource" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetricType" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetricType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeSeriesData" (
    "effectiveTime" TIMESTAMP(3) NOT NULL,
    "recordedTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assetId" INTEGER NOT NULL,
    "metricTypeId" INTEGER NOT NULL,
    "dataSourceId" INTEGER NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "TimeSeriesData_pkey" PRIMARY KEY ("effectiveTime","assetId","metricTypeId","dataSourceId","recordedTime")
);

-- CreateIndex
CREATE UNIQUE INDEX "Asset_name_key" ON "Asset"("name");

-- CreateIndex
CREATE UNIQUE INDEX "DataSource_name_key" ON "DataSource"("name");

-- CreateIndex
CREATE UNIQUE INDEX "MetricType_name_key" ON "MetricType"("name");

-- CreateIndex
CREATE INDEX "TimeSeriesData_effectiveTime_idx" ON "TimeSeriesData"("effectiveTime" DESC);

-- CreateIndex
CREATE INDEX "TimeSeriesData_assetId_metricTypeId_idx" ON "TimeSeriesData"("assetId", "metricTypeId");

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeSeriesData" ADD CONSTRAINT "TimeSeriesData_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeSeriesData" ADD CONSTRAINT "TimeSeriesData_metricTypeId_fkey" FOREIGN KEY ("metricTypeId") REFERENCES "MetricType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeSeriesData" ADD CONSTRAINT "TimeSeriesData_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
