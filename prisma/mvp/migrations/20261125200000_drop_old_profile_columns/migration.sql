-- Phase-1 Business Profile columns, replaced by the 9 spec fields on 17/11. Only test data left in them.
ALTER TABLE "BusinessProfile" DROP COLUMN IF EXISTS "whatYouSell",
  DROP COLUMN IF EXISTS "city",
  DROP COLUMN IF EXISTS "toneOfVoice",
  DROP COLUMN IF EXISTS "differentials",
  DROP COLUMN IF EXISTS "postingCadence";
