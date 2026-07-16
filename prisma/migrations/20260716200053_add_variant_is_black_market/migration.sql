-- AlterTable
ALTER TABLE "Variant" ADD COLUMN     "isBlackMarket" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Variant_isBlackMarket_idx" ON "Variant"("isBlackMarket");
