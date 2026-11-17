-- Phase 3b: shot list and export (expand-only)
-- AlterTable
ALTER TABLE "Export" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "ShotList" ADD COLUMN     "assets" TEXT[],
ADD COLUMN     "importantNote" TEXT,
ADD COLUMN     "locations" TEXT[],
ADD COLUMN     "people" TEXT[],
ADD COLUMN     "sessions" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'pending',
ADD COLUMN     "summary" TEXT,
ADD COLUMN     "title" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "ShotListItem" ADD COLUMN     "stage" TEXT NOT NULL DEFAULT 'filming';

