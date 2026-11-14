-- CreateTable
CREATE TABLE "StoryPost" (
    "id" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "data" JSONB NOT NULL,
    "tgMessageId" INTEGER,
    "decidedBy" TEXT,
    "igMediaId" TEXT,
    "error" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoryPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StoryPost_day_status_idx" ON "StoryPost"("day", "status");
