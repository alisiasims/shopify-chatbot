-- AlterTable
ALTER TABLE "ChatSession" ADD COLUMN "topic" TEXT;

-- Backfill: e-mails Deisi skipped as adverts / newsletters / spam / notifications / cold supplier offers
UPDATE "ChatSession" s SET "topic" = 'spam'
WHERE s."topic" IS NULL AND EXISTS (
  SELECT 1 FROM "Message" m
  WHERE m."sessionId" = s."id" AND m."role" = 'assistant'
    AND (m."meta"::jsonb -> 'skip' ->> 'category') IN ('advert', 'newsletter', 'spam', 'notification', 'supplier')
);
