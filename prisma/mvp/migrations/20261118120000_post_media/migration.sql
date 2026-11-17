-- Phase 4a: post editing, media, reminders (expand-only)
-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "note" TEXT,
ADD COLUMN     "reminderSentAt" TIMESTAMP(3),
ADD COLUMN     "timeSuggested" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "PostMedia" ADD COLUMN     "framePaths" TEXT[],
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'image';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "reminderTime" TEXT NOT NULL DEFAULT '09:00',
ADD COLUMN     "remindersOn" BOOLEAN NOT NULL DEFAULT true;

