-- Phase 12 · Monthly review and milestones. Both tables were empty placeholders from the first migration.
ALTER TABLE "Milestone" ADD COLUMN "date" DATE NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN "title" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "items" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "reviewId" TEXT;
ALTER TABLE "Milestone" ALTER COLUMN "date" DROP DEFAULT, ALTER COLUMN "title" DROP DEFAULT;
CREATE UNIQUE INDEX "Milestone_reviewId_key" ON "Milestone"("reviewId");
CREATE INDEX "Milestone_userId_date_idx" ON "Milestone"("userId", "date");

ALTER TABLE "MonthlyReview" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'preparing',
  ADD COLUMN "facts" JSONB,
  ADD COLUMN "batchId" TEXT,
  ADD COLUMN "conversationId" TEXT,
  ADD COLUMN "data" JSONB,
  ADD COLUMN "preparedAt" TIMESTAMP(3),
  ADD COLUMN "startedAt" TIMESTAMP(3),
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX "MonthlyReview_status_idx" ON "MonthlyReview"("status");
