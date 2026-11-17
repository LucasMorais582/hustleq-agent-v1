-- Phase 7: plan, limits and billing (expand-only)
-- AlterTable
ALTER TABLE "Invite" ADD COLUMN     "billingExempt" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "firstAccess" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "LimitRenewal" ADD COLUMN     "amountCents" INTEGER NOT NULL DEFAULT 2000,
ADD COLUMN     "stripeSessionId" TEXT;

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "endedAt" TIMESTAMP(3),
ADD COLUMN     "firstAccess" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "graceUntil" TIMESTAMP(3),
ADD COLUMN     "syncedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "billingExempt" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "LimitRenewal_stripeSessionId_key" ON "LimitRenewal"("stripeSessionId");


-- Everyone who already has an account was created before billing (team, test and FPP accounts): exempt.
UPDATE "User" SET "billingExempt" = true;
