-- CreateEnum
CREATE TYPE "ForecastScope" AS ENUM ('GLOBAL', 'CATEGORY');

-- AlterEnum
ALTER TYPE "SyncResource" ADD VALUE 'FORECAST';

-- CreateTable
CREATE TABLE "SalesForecast" (
    "id" TEXT NOT NULL,
    "scope" "ForecastScope" NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "targetYear" INTEGER NOT NULL,
    "targetMonth" INTEGER NOT NULL,
    "generatedOn" TIMESTAMP(3) NOT NULL,
    "predictedUnits" DOUBLE PRECISION NOT NULL,
    "predictedRevenue" DECIMAL(12,2) NOT NULL,
    "baseUnitsRate" DOUBLE PRECISION NOT NULL,
    "seasonalIndex" DOUBLE PRECISION NOT NULL,
    "seasonalTrusted" BOOLEAN NOT NULL,
    "growthFactor" DOUBLE PRECISION NOT NULL,
    "growthTrusted" BOOLEAN NOT NULL,
    "actualUnits" DOUBLE PRECISION,
    "actualRevenue" DECIMAL(12,2),
    "reconciledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesForecast_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SalesForecast_scope_scopeKey_targetYear_targetMonth_idx" ON "SalesForecast"("scope", "scopeKey", "targetYear", "targetMonth");

-- CreateIndex
CREATE INDEX "SalesForecast_generatedOn_idx" ON "SalesForecast"("generatedOn");

-- CreateIndex
CREATE UNIQUE INDEX "SalesForecast_scope_scopeKey_targetYear_targetMonth_generat_key" ON "SalesForecast"("scope", "scopeKey", "targetYear", "targetMonth", "generatedOn");
