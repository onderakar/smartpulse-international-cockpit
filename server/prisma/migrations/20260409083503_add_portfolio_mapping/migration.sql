-- CreateTable
CREATE TABLE "PortfolioMapping" (
    "id" SERIAL NOT NULL,
    "groupId" TEXT NOT NULL,
    "portfolioType" TEXT NOT NULL DEFAULT 'DAM',
    "externalId" TEXT NOT NULL,
    "displayName" TEXT,
    "companyId" INTEGER NOT NULL,
    "companyName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "PortfolioMapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PortfolioMapping_groupId_portfolioType_idx" ON "PortfolioMapping"("groupId", "portfolioType");

-- CreateIndex
CREATE UNIQUE INDEX "PortfolioMapping_groupId_portfolioType_externalId_key" ON "PortfolioMapping"("groupId", "portfolioType", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "PortfolioMapping_groupId_portfolioType_companyId_key" ON "PortfolioMapping"("groupId", "portfolioType", "companyId");
