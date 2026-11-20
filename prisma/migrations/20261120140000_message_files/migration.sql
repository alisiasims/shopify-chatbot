-- CreateTable
CREATE TABLE "MessageFile" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MessageFile_messageId_idx" ON "MessageFile"("messageId");
