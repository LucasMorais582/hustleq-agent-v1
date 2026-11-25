-- Social Data API ids: the profile reserved for an invite and the profile each user owns there.
ALTER TABLE "User" ADD COLUMN "socialProfileId" TEXT;
ALTER TABLE "User" ADD COLUMN "socialMonitoringUntil" TIMESTAMP(3);
CREATE UNIQUE INDEX "User_socialProfileId_key" ON "User"("socialProfileId");
ALTER TABLE "Invite" ADD COLUMN "socialProfileId" TEXT;
