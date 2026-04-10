-- AlterTable
ALTER TABLE "IntradayTransaction" ADD COLUMN     "alertName" TEXT,
ADD COLUMN     "mcp" DOUBLE PRECISION,
ADD COLUMN     "orderType" TEXT,
ADD COLUMN     "remoteOrderId" TEXT,
ADD COLUMN     "smartbotId" INTEGER,
ADD COLUMN     "smp" DOUBLE PRECISION;
