-- AlterTable
ALTER TABLE "IntradayTransaction" ADD COLUMN     "isLatestRevision" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "IntradayTransaction_groupId_companyId_isLatestRevision_deli_idx" ON "IntradayTransaction"("groupId", "companyId", "isLatestRevision", "deliveryStart");
