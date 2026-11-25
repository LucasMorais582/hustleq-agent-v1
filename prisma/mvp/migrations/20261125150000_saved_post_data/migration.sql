-- Explore · Saved (9.6): keep the post as shown, since Discover results expire.
ALTER TABLE "SavedPost" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'explore';
ALTER TABLE "SavedPost" ADD COLUMN "data" JSONB;
