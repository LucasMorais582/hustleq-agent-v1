-- Phase 5: campaigns, commercial dates and notes (expand-only)
-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "conversationId" TEXT,
ADD COLUMN     "objective" TEXT,
ADD COLUMN     "strategyId" TEXT;

-- AlterTable
ALTER TABLE "CommercialDate" ADD COLUMN     "tip" TEXT;

-- AlterTable
ALTER TABLE "Note" ADD COLUMN     "postId" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'manual',
ADD COLUMN     "title" TEXT;

-- AlterTable
ALTER TABLE "NoteReference" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'own',
ADD COLUMN     "label" TEXT,
ADD COLUMN     "thumbnailUrl" TEXT;

-- AlterTable
ALTER TABLE "UserCommercialDate" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "repeats" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "skippedYear" INTEGER,
ADD COLUMN     "suggestCampaign" BOOLEAN NOT NULL DEFAULT true;


-- US commercial dates (7.5). Later years are added the same way.
INSERT INTO "CommercialDate" ("id", "name", "date", "country", "niches", "tip") VALUES
  (gen_random_uuid(), 'Thanksgiving', DATE '2026-11-26', 'US', ARRAY[]::text[], 'Good for gratitude posts and holiday orders'),
  (gen_random_uuid(), 'Black Friday', DATE '2026-11-27', 'US', ARRAY[]::text[], 'Best for offers and pre-orders'),
  (gen_random_uuid(), 'Small Business Saturday', DATE '2026-11-28', 'US', ARRAY[]::text[], 'Good for local pride and your regulars'),
  (gen_random_uuid(), 'Cyber Monday', DATE '2026-11-30', 'US', ARRAY[]::text[], 'Good for gift cards and pre-orders'),
  (gen_random_uuid(), 'Giving Tuesday', DATE '2026-12-01', 'US', ARRAY[]::text[], 'Good for community and causes you support'),
  (gen_random_uuid(), 'Christmas', DATE '2026-12-25', 'US', ARRAY[]::text[], 'Good for holiday menus, gifts and last-minute orders'),
  (gen_random_uuid(), 'New Year''s Eve', DATE '2026-12-31', 'US', ARRAY[]::text[], 'Good for parties, celebrations and year recaps'),
  (gen_random_uuid(), 'New Year''s Day', DATE '2027-01-01', 'US', ARRAY[]::text[], 'Good for fresh starts and what''s coming this year'),
  (gen_random_uuid(), 'Valentine''s Day', DATE '2027-02-14', 'US', ARRAY[]::text[], 'Good for couples, gifts and special menus'),
  (gen_random_uuid(), 'St. Patrick''s Day', DATE '2027-03-17', 'US', ARRAY[]::text[], 'Good for themed specials and green touches'),
  (gen_random_uuid(), 'Easter', DATE '2027-03-28', 'US', ARRAY[]::text[], 'Good for family gatherings and spring menus'),
  (gen_random_uuid(), 'Mother''s Day', DATE '2027-05-09', 'US', ARRAY[]::text[], 'Good for gifts, brunch and thank-you posts'),
  (gen_random_uuid(), 'Memorial Day', DATE '2027-05-31', 'US', ARRAY[]::text[], 'Good for cookouts and the start of summer'),
  (gen_random_uuid(), 'Father''s Day', DATE '2027-06-20', 'US', ARRAY[]::text[], 'Good for gifts and family meals'),
  (gen_random_uuid(), 'Independence Day', DATE '2027-07-04', 'US', ARRAY[]::text[], 'Good for cookouts, parties and big orders'),
  (gen_random_uuid(), 'Labor Day', DATE '2027-09-06', 'US', ARRAY[]::text[], 'Good for end-of-summer gatherings'),
  (gen_random_uuid(), 'Halloween', DATE '2027-10-31', 'US', ARRAY[]::text[], 'Good for themed treats and costumes'),
  (gen_random_uuid(), 'Thanksgiving', DATE '2027-11-25', 'US', ARRAY[]::text[], 'Good for gratitude posts and holiday orders'),
  (gen_random_uuid(), 'Black Friday', DATE '2027-11-26', 'US', ARRAY[]::text[], 'Best for offers and pre-orders'),
  (gen_random_uuid(), 'Small Business Saturday', DATE '2027-11-27', 'US', ARRAY[]::text[], 'Good for local pride and your regulars'),
  (gen_random_uuid(), 'Cyber Monday', DATE '2027-11-29', 'US', ARRAY[]::text[], 'Good for gift cards and pre-orders'),
  (gen_random_uuid(), 'Giving Tuesday', DATE '2027-11-30', 'US', ARRAY[]::text[], 'Good for community and causes you support'),
  (gen_random_uuid(), 'Christmas', DATE '2027-12-25', 'US', ARRAY[]::text[], 'Good for holiday menus, gifts and last-minute orders'),
  (gen_random_uuid(), 'New Year''s Eve', DATE '2027-12-31', 'US', ARRAY[]::text[], 'Good for parties, celebrations and year recaps')
ON CONFLICT ("name", "date") DO NOTHING;
