-- DropIndex: a week can be drafted more than once before one is saved.
DROP INDEX "Week_userId_startsOn_key";

-- (BusinessProfile's old columns are dropped in a later cleanup migration.)

-- AlterTable
ALTER TABLE "Pillar" ADD COLUMN     "baseType" TEXT,
ADD COLUMN     "goal" TEXT;

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "captionParts" JSONB,
ADD COLUMN     "contentType" TEXT,
ADD COLUMN     "hashtags" TEXT[],
ADD COLUMN     "idea" JSONB,
ADD COLUMN     "position" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "postingReminders" TEXT[];

-- AlterTable
ALTER TABLE "Strategy" ADD COLUMN     "conversationId" TEXT,
ADD COLUMN     "durationWeeks" INTEGER NOT NULL DEFAULT 8,
ADD COLUMN     "objective" TEXT,
ADD COLUMN     "staticPerWeek" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "storiesPerWeek" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "videosPerWeek" INTEGER NOT NULL DEFAULT 2,
ALTER COLUMN "status" SET DEFAULT 'draft';

-- AlterTable
ALTER TABLE "Week" ADD COLUMN     "bestTime" TEXT,
ADD COLUMN     "conversationId" TEXT;

-- CreateIndex
CREATE INDEX "Week_userId_startsOn_idx" ON "Week"("userId", "startsOn");

