-- CreateTable
CREATE TABLE "DemoNiche" (
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "keywords" TEXT[],
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DemoNiche_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "DemoTrendSnapshot" (
    "id" TEXT NOT NULL,
    "nicheKey" TEXT NOT NULL,
    "posts" JSONB NOT NULL,
    "summary" JSONB NOT NULL,
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DemoTrendSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DemoProfileCache" (
    "handle" TEXT NOT NULL,
    "profile" JSONB NOT NULL,
    "posts" JSONB NOT NULL,
    "insight" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DemoProfileCache_pkey" PRIMARY KEY ("handle")
);

-- CreateTable
CREATE TABLE "DemoRun" (
    "id" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "nicheKey" TEXT NOT NULL,
    "answers" JSONB NOT NULL,
    "idea" JSONB,
    "durationMs" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DemoRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DemoTrendSnapshot_nicheKey_collectedAt_idx" ON "DemoTrendSnapshot"("nicheKey", "collectedAt");

-- CreateIndex
CREATE INDEX "DemoRun_createdAt_idx" ON "DemoRun"("createdAt");

-- AddForeignKey
ALTER TABLE "DemoTrendSnapshot" ADD CONSTRAINT "DemoTrendSnapshot_nicheKey_fkey" FOREIGN KEY ("nicheKey") REFERENCES "DemoNiche"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

