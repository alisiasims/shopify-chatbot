-- CreateTable
CREATE TABLE "ShipmentWatch" (
    "id" TEXT NOT NULL,
    "orderRef" TEXT,
    "carrier" TEXT,
    "country" TEXT,
    "parcelId" TEXT,
    "trackingLink" TEXT,
    "status" TEXT NOT NULL,
    "statusSince" TIMESTAMP(3) NOT NULL,
    "alertedFor" TEXT,
    "alertedAt" TIMESTAMP(3),
    "checkedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShipmentWatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShipmentWatch_status_statusSince_idx" ON "ShipmentWatch"("status", "statusSince");
