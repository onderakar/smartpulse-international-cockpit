-- CreateTable
CREATE TABLE "IntradayTransaction" (
    "id" SERIAL NOT NULL,
    "groupId" TEXT NOT NULL,
    "remoteTradeId" TEXT NOT NULL,
    "companyId" INTEGER NOT NULL,
    "companyName" TEXT NOT NULL,
    "deliveryStart" TIMESTAMP(3) NOT NULL,
    "deliveryEnd" TIMESTAMP(3) NOT NULL,
    "direction" BOOLEAN NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "tradeTime" TIMESTAMP(3) NOT NULL,
    "contractId" TEXT,
    "contractName" TEXT,
    "productType" TEXT,
    "status" INTEGER NOT NULL DEFAULT 0,
    "revisionNo" INTEGER NOT NULL DEFAULT 1,
    "username" TEXT,
    "explanation" TEXT,
    "platformCode" TEXT,
    "areaCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntradayTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IntradayTransaction_groupId_companyId_deliveryStart_idx" ON "IntradayTransaction"("groupId", "companyId", "deliveryStart");

-- CreateIndex
CREATE INDEX "IntradayTransaction_groupId_deliveryStart_idx" ON "IntradayTransaction"("groupId", "deliveryStart");

-- CreateIndex
CREATE UNIQUE INDEX "IntradayTransaction_groupId_remoteTradeId_key" ON "IntradayTransaction"("groupId", "remoteTradeId");
