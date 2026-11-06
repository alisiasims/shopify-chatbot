-- AlterTable
ALTER TABLE "Handoff" ADD COLUMN "reminders" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Handoff" ADD COLUMN "remindedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "TeamTask" (
    "id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "sessionId" TEXT,
    "by" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "doneAt" TIMESTAMP(3),
    CONSTRAINT "TeamTask_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TeamTask_status_createdAt_idx" ON "TeamTask"("status", "createdAt");

-- CreateTable
CREATE TABLE "StaffQuestion" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "tgMessageId" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'asked',
    "answer" TEXT,
    "by" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" TIMESTAMP(3),
    CONSTRAINT "StaffQuestion_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StaffQuestion_status_createdAt_idx" ON "StaffQuestion"("status", "createdAt");
CREATE INDEX "StaffQuestion_tgMessageId_idx" ON "StaffQuestion"("tgMessageId");
