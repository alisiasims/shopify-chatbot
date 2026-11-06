-- AlterTable
ALTER TABLE "ChatSession" ADD COLUMN "reviewedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "FollowUp" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "doneAt" TIMESTAMP(3),

    CONSTRAINT "FollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FollowUp_status_createdAt_idx" ON "FollowUp"("status", "createdAt");

-- CreateIndex
CREATE INDEX "FollowUp_sessionId_createdAt_idx" ON "FollowUp"("sessionId", "createdAt");

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ChatSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
