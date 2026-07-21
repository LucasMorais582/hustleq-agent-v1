import type { AgentInput }
from "../../types/agent.types.js";

import { getLatestWeekBlueprint }
from "../../repositories/conversation.repository.js";

import { processPostBatch }
from "./processPostBatch.js";

import { validateWeekPipeline }
from "../validators/validateWeekPipeline.js";

export async function generateWeekPipeline(
  input: AgentInput
) {
  /*
  STEP 1
  Load approved blueprint
  */

  if (!input.conversationId) {
    throw new Error(
      "Conversation ID is required"
    );
  }

  if (!input.weekNumber) {
    throw new Error(
      "Week number is required"
    );
  }

  const blueprint =
    await getLatestWeekBlueprint(
      input.conversationId,
      input.weekNumber
    );

  if (
    !blueprint ||
    !blueprint.blueprint ||
    !Array.isArray(
      blueprint.blueprint
    )
  ) {
    throw new Error(
      `Approved blueprint for week ${input.weekNumber} not found`
    );
  }

  /*
    STEP 2
    Process posts in batches
  */

  const generatedPosts = [];

  /*
    Batch size
  */

  const BATCH_SIZE = 3;

  /*
    Process 3 posts at a time
  */

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

    console.log(
      `Processing batch ${
        i / BATCH_SIZE + 1
      }`
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

  /*
    STEP 3
    Organize by type
  */

  const staticPosts =
    generatedPosts.filter(
      (p) =>
        p.contentType ===
        "static"
    );

  const dynamicPosts =
    generatedPosts.filter(
      (p) =>
        p.contentType ===
        "dynamic"
    );

  const stories =
    generatedPosts.filter(
      (p) =>
        p.contentType ===
        "story"
    );

  /*
    STEP 4
    Final object
  */

  const week = {
    week: input.weekNumber,
    staticPosts,
    dynamicPosts,
    stories,
  };

  /*
    STEP 5
    Validate
  */

  const isValid =
    validateWeekPipeline(
      week,
      input.planConfig
    );

  if (!isValid) {
    throw new Error(
      "Generated week pipeline is invalid"
    );
  }

  console.log(
    "Week pipeline validation passed"
  );

  return week;
}