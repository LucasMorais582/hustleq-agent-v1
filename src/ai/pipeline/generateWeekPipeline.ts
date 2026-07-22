import type { AgentInput } from "../../types/agent.types.js";
import { getLatestWeekBlueprint } from "../../repositories/conversation.repository.js";
import { processPostBatch } from "./processPostBatch.js";
import { retryWeekExecutionRequirements } from "../retries/retryWeekExecutionRequirements.js";
import { validateWeekPipeline } from "../validators/validateWeekPipeline.js";
import { validateWeekExecutionRequirements } from "../validators/validateWeekExecutionRequirements.js";

export async function generateWeekPipeline(input: AgentInput) {
  /*
    STEP 1
    Load approved blueprint
  */

  if (!input.conversationId) {
    throw new Error("Conversation ID is required");
  }

  if (!input.weekNumber) {
    throw new Error("Week number is required");
  }

  const blueprint = await getLatestWeekBlueprint(
      input.conversationId,
      input.weekNumber
  );

  if (!blueprint || !blueprint.blueprint || !Array.isArray(blueprint.blueprint)) {
    throw new Error(`Approved blueprint for week ${input.weekNumber} not found`);
  }

  /*
    STEP 2
    Process posts in batches
  */

  const BATCH_SIZE = 3;
  const generatedPosts = [];

  for (let i = 0; i < blueprint.blueprint.length; i += BATCH_SIZE) {
    const batch = blueprint.blueprint.slice(i,i + BATCH_SIZE);
    console.log(`Processing batch ${i / BATCH_SIZE + 1}`);

    const batchResults = await processPostBatch(batch, input);
    generatedPosts.push(...batchResults);
  }

  /*
    STEP 3
    Organize by type
  */

  const staticPosts = generatedPosts.filter((p) =>
    p.contentType === "static"
  );

  const dynamicPosts = generatedPosts.filter((p) =>
      p.contentType === "dynamic"
  );

  const stories = generatedPosts.filter((p) =>
      p.contentType === "story"
  );

  /*
    STEP 4
    Build week
  */

  const week: any = {
    week: input.weekNumber,
    staticPosts,
    dynamicPosts,
    stories,
  };

  /*
    STEP 5
    Generate week preparation
  */

  console.log("Generating week execution requirements...");
  week.executionRequirements = await retryWeekExecutionRequirements(input, week);
  console.log("Week execution requirements generated successfully");

  /*
    STEP 6
    Validate
  */

  const isValid = validateWeekPipeline(week, input.planConfig);
  const isExecutionRequirementsValid = validateWeekExecutionRequirements(week.executionRequirements);

  if (!isValid || !isExecutionRequirementsValid) {
    throw new Error("Generated week pipeline is invalid");
  }
  console.log("Week pipeline validation passed");

  return week;
}