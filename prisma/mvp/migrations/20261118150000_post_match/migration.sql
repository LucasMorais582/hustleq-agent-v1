-- Phase 4b: post match dismissals (expand-only)
-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "dismissedMatches" TEXT[];

