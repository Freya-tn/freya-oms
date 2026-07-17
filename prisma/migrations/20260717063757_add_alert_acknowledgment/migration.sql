-- CreateTable
CREATE TABLE "AlertAcknowledgment" (
    "id" TEXT NOT NULL,
    "alertKey" TEXT NOT NULL,
    "acknowledgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedBy" TEXT,

    CONSTRAINT "AlertAcknowledgment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AlertAcknowledgment_alertKey_key" ON "AlertAcknowledgment"("alertKey");
