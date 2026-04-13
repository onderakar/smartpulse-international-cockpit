-- CreateTable
CREATE TABLE "BackfillAttempt" (
    "id" SERIAL NOT NULL,
    "assetName" TEXT NOT NULL,
    "rangeStart" TIMESTAMP(3) NOT NULL,
    "rangeEnd" TIMESTAMP(3) NOT NULL,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pointsFound" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "BackfillAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BackfillAttempt_assetName_attemptedAt_idx" ON "BackfillAttempt"("assetName", "attemptedAt");

-- CreateIndex
CREATE INDEX "BackfillAttempt_assetName_rangeStart_rangeEnd_idx" ON "BackfillAttempt"("assetName", "rangeStart", "rangeEnd");
