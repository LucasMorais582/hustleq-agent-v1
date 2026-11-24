-- Commercial dates by niche: Duke suggests them per business, the team reviews (expand-only)
-- AlterTable
ALTER TABLE "UserCommercialDate" ADD COLUMN     "reviewStatus" TEXT NOT NULL DEFAULT 'approved',
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'own',
ADD COLUMN     "tip" TEXT;
