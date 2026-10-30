/*
  npm run demo:refresh-trends            -> every active niche
  npm run demo:refresh-trends -- hair    -> only the given niche keys

  Runs as a daily Railway cron during the event. Each keyword is one Apify run (~1 min),
  so niches are processed a few at a time.
*/

import "../../config/env.js";
import { prisma } from "../../lib/prisma.js";
import { refreshNicheTrends } from "../demoTrends.service.js";

const CONCURRENCY = Number(process.env.DEMO_REFRESH_CONCURRENCY || 3);

async function main() {
  const only = process.argv.slice(2);

  const niches = await prisma.demoNiche.findMany({
    where: { active: true, ...(only.length ? { key: { in: only } } : {}) },
    orderBy: { position: "asc" },
  });

  console.log(`[demo] refreshing ${niches.length} niches, ${CONCURRENCY} at a time`);

  const queue = [...niches];
  let saved = 0;

  async function worker() {
    for (let niche = queue.shift(); niche; niche = queue.shift()) {
      const started = Date.now();

      try {
        const snapshot = await refreshNicheTrends(niche);
        if (snapshot) saved++;
        console.log(`[demo] ${niche.key}: ${snapshot ? "saved" : "skipped"} in ${Math.round((Date.now() - started) / 1000)}s`);
      } catch (error: any) {
        console.error(`[demo] ${niche.key} failed:`, error.message);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  console.log(`[demo] done: ${saved}/${niches.length} niches updated`);
  if (saved === 0 && niches.length) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
