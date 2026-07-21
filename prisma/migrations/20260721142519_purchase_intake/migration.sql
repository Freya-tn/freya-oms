-- CreateTable
CREATE TABLE "PurchaseIntake" (
    "id" TEXT NOT NULL,
    "vendor" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'in_progress',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseIntake_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseIntakeLine" (
    "id" TEXT NOT NULL,
    "purchaseIntakeId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "quantityPurchased" INTEGER NOT NULL,
    "purchasePrice" DECIMAL(12,2) NOT NULL,
    "previousQuantity" INTEGER NOT NULL,
    "previousCost" DECIMAL(12,2),
    "newQuantity" INTEGER NOT NULL,
    "newCost" DECIMAL(12,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "errorMessage" TEXT,
    "appliedAt" TIMESTAMP(3),

    CONSTRAINT "PurchaseIntakeLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PurchaseIntakeLine_purchaseIntakeId_idx" ON "PurchaseIntakeLine"("purchaseIntakeId");

-- CreateIndex
CREATE INDEX "PurchaseIntakeLine_variantId_idx" ON "PurchaseIntakeLine"("variantId");

-- AddForeignKey
ALTER TABLE "PurchaseIntakeLine" ADD CONSTRAINT "PurchaseIntakeLine_purchaseIntakeId_fkey" FOREIGN KEY ("purchaseIntakeId") REFERENCES "PurchaseIntake"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseIntakeLine" ADD CONSTRAINT "PurchaseIntakeLine_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
