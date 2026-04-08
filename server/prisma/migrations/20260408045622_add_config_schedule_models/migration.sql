-- CreateTable
CREATE TABLE "GroupProfile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "portalEnv" TEXT NOT NULL DEFAULT 'prod',
    "assetMapping" JSONB NOT NULL DEFAULT '{}',
    "polling" JSONB NOT NULL,
    "monitoringCredentials" JSONB,
    "graphQlApiKey" TEXT,
    "scheduleBapEditable" BOOLEAN NOT NULL DEFAULT false,
    "defaultResolutionMinutes" INTEGER,
    "customAttributeDefinitions" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GroupProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserProfile" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "widgetLayout" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleRevision" (
    "id" SERIAL NOT NULL,
    "gcpId" INTEGER NOT NULL,
    "dateKey" TEXT NOT NULL,
    "deliveryStart" TEXT NOT NULL,
    "row" JSONB NOT NULL,
    "fetchedAt" BIGINT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'ftp',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduleRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserProfile_groupId_idx" ON "UserProfile"("groupId");

-- CreateIndex
CREATE INDEX "ScheduleRevision_gcpId_dateKey_idx" ON "ScheduleRevision"("gcpId", "dateKey");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleRevision_gcpId_dateKey_deliveryStart_contentHash_key" ON "ScheduleRevision"("gcpId", "dateKey", "deliveryStart", "contentHash");

-- AddForeignKey
ALTER TABLE "UserProfile" ADD CONSTRAINT "UserProfile_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "GroupProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
