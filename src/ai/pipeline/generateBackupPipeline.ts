import type { AgentInput } from "../../types/agent.types.js";

import { generateWeekBlueprint }
from "./generateWeekBlueprint.js";

import { processPostBatch }
from "./processPostBatch.js";

import { validateWeekPipeline }
from "../validators/validateWeekPipeline.js";

export async function generateBackupPipeline(
  input: AgentInput
) {

  const blueprint =
    await generateWeekBlueprint({
      ...input,
      mode: "CONTENT_BACKUP_BLUEPRINT",
    });

  const generatedPosts = [];

  const BATCH_SIZE = 3;

  for (
    let i = 0;
    i < blueprint.blueprint.length;
    i += BATCH_SIZE
  ) {
    const batch =
      blueprint.blueprint.slice(
        i,
        i + BATCH_SIZE
      );

    const batchResults =
      await processPostBatch(
        batch,
        input
      );

    generatedPosts.push(
      ...batchResults
    );
  }

  const backup = {
    staticPosts:
      generatedPosts.filter(
        p => p.contentType === "static"
      ),

    dynamicPosts:
      generatedPosts.filter(
        p => p.contentType === "dynamic"
      ),

    stories:
      generatedPosts.filter(
        p => p.contentType === "story"
      ),
  };

  const valid =
    validateWeekPipeline(
      backup,
      input.planConfig
    );

  if (!valid) {
    throw new Error(
      "Generated backup is invalid"
    );
  }

  return backup;
}