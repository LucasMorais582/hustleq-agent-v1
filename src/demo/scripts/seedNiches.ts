/*
  npm run demo:seed-niches
  Upserts the niche list. Niches removed from the list are deactivated, not deleted,
  so their snapshots and runs stay valid.
*/

import "../../config/env.js";
import { prisma } from "../../lib/prisma.js";
import { DEMO_NICHES } from "../niches.js";

async function main() {
  for (const [position, niche] of DEMO_NICHES.entries()) {
    await prisma.demoNiche.upsert({
      where: { key: niche.key },
      create: { ...niche, position, active: true },
      update: { label: niche.label, keywords: niche.keywords, position, active: true },
    });
  }

  const { count } = await prisma.demoNiche.updateMany({
    where: { key: { notIn: DEMO_NICHES.map((n) => n.key) } },
    data: { active: false },
  });

  console.log(`[demo] ${DEMO_NICHES.length} niches upserted, ${count} deactivated`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
