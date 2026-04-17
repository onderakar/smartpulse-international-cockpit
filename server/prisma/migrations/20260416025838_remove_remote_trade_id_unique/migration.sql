-- DropIndex
DROP INDEX "IntradayTransaction_groupId_remoteTradeId_key";

-- CreateIndex
CREATE INDEX "IntradayTransaction_groupId_remoteTradeId_idx" ON "IntradayTransaction"("groupId", "remoteTradeId");
