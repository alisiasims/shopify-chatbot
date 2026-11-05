-- CreateTable
CREATE TABLE "TeamLog" (
    "id" TEXT NOT NULL,
    "dir" TEXT NOT NULL,
    "who" TEXT,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TeamLog_createdAt_idx" ON "TeamLog"("createdAt");
