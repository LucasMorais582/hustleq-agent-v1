-- AlterTable
-- Expand only: the old columns (city, differentials, postingCadence, toneOfVoice, whatYouSell)
-- stay until the phase 1 build is replaced in production; a later migration drops them.
ALTER TABLE "BusinessProfile" ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "customerChannels" TEXT,
ADD COLUMN     "customerProblem" TEXT,
ADD COLUMN     "location" TEXT,
ADD COLUMN     "niche" TEXT,
ADD COLUMN     "offers" TEXT,
ADD COLUMN     "whatYouDo" TEXT;

-- AlterTable
ALTER TABLE "OnboardingState" ADD COLUMN     "conversationId" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'active';

-- CreateTable
CREATE TABLE "InstagramCache" (
    "handle" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstagramCache_pkey" PRIMARY KEY ("handle")
);

-- CreateTable
CREATE TABLE "AccountChangeRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "currentHandle" TEXT,
    "requestedHandle" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "AccountChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccountChangeRequest_status_idx" ON "AccountChangeRequest"("status");

