-- AlterTable
ALTER TABLE "IntradayTransaction" ADD COLUMN     "downBalancingPrice" DOUBLE PRECISION,
ADD COLUMN     "initialDate" TIMESTAMP(3),
ADD COLUMN     "initialUserId" INTEGER,
ADD COLUMN     "innerProductType" INTEGER,
ADD COLUMN     "libraryName" TEXT,
ADD COLUMN     "orderDate" TIMESTAMP(3),
ADD COLUMN     "upBalancingPrice" DOUBLE PRECISION;
