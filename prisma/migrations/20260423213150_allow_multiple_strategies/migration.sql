-- DropForeignKey
ALTER TABLE "ContentStrategy" DROP CONSTRAINT "ContentStrategy_userId_fkey";

-- DropIndex
DROP INDEX "ContentStrategy_userId_key";
