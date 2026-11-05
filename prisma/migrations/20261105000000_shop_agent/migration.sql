-- AlterTable
ALTER TABLE "ChatSession" ADD COLUMN "channel" TEXT NOT NULL DEFAULT 'app',
ADD COLUMN "visitorId" TEXT,
ADD COLUMN "externalId" TEXT,
ADD COLUMN "customerName" TEXT,
ADD COLUMN "customerEmail" TEXT,
ADD COLUMN "lang" TEXT,
ADD COLUMN "pageUrl" TEXT,
ADD COLUMN "needsHuman" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN "attachments" JSONB,
ADD COLUMN "meta" JSONB;

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "tags" TEXT[],
    "productType" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL DEFAULT '',
    "image" TEXT,
    "priceMin" DOUBLE PRECISION NOT NULL,
    "priceMax" DOUBLE PRECISION NOT NULL,
    "compareAt" DOUBLE PRECISION,
    "inStock" BOOLEAN NOT NULL DEFAULT true,
    "options" JSONB NOT NULL,
    "variants" JSONB NOT NULL,
    "url" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Handoff" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT,
    "channel" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "contact" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "notified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Handoff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "ChatSession_channel_updatedAt_idx" ON "ChatSession"("channel", "updatedAt");

-- CreateIndex
CREATE INDEX "ChatSession_visitorId_idx" ON "ChatSession"("visitorId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatSession_channel_externalId_key" ON "ChatSession"("channel", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_handle_key" ON "Product"("handle");

-- CreateIndex
CREATE INDEX "Product_syncedAt_idx" ON "Product"("syncedAt");

-- CreateIndex
CREATE INDEX "Handoff_status_createdAt_idx" ON "Handoff"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "Handoff" ADD CONSTRAINT "Handoff_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ChatSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
