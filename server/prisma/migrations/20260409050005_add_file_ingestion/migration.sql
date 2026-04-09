-- CreateTable
CREATE TABLE "FileSource" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'incoming',
    "fileType" TEXT,
    "intervalMinutes" INTEGER NOT NULL DEFAULT 10,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "parserKey" TEXT,
    "groupId" TEXT NOT NULL,
    "lastCheckedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FileSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileVersion" (
    "id" SERIAL NOT NULL,
    "sourceId" INTEGER NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "rawContent" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FileSource_groupId_enabled_idx" ON "FileSource"("groupId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "FileSource_groupId_key_key" ON "FileSource"("groupId", "key");

-- CreateIndex
CREATE INDEX "FileVersion_sourceId_isCurrent_idx" ON "FileVersion"("sourceId", "isCurrent");

-- CreateIndex
CREATE INDEX "FileVersion_sourceId_fetchedAt_idx" ON "FileVersion"("sourceId", "fetchedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "FileVersion_sourceId_contentHash_key" ON "FileVersion"("sourceId", "contentHash");

-- AddForeignKey
ALTER TABLE "FileVersion" ADD CONSTRAINT "FileVersion_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "FileSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
