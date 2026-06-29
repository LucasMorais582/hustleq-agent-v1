import type { AgentInput }
from "../../types/agent.types.js";

import { generateWeekBlueprint }
from "./generateWeekBlueprint.js";

import { generateSinglePost }
from "./generateSinglePost.js";

export async function generateWeekPipeline(
  input: AgentInput
) {
  /*
    STEP 1
  */
  console.log("PIPELINE INPUT:");
  console.log(JSON.stringify(input, null, 2));
  const blueprint = await generateWeekBlueprint(input);
  if (!blueprint || !blueprint.blueprint || !Array.isArray(blueprint.blueprint)) {
    throw new Error(
      "Invalid blueprint response"
    );
  }

  /*
    STEP 2
  */

  const generatedPosts = [];

  /*
    STEP 3
  */

  for (const item of blueprint.blueprint) {
    const post =
      await generateSinglePost({
        ...input,
        blueprintItem: item,
      });

    generatedPosts.push({
      ...post,
      contentType: item.contentType,
    });
  }

  /*
    STEP 4
  */

  const staticPosts =
    generatedPosts.filter(
      (p) => p.contentType === "static"
    );

  const dynamicPosts =
    generatedPosts.filter(
      (p) => p.contentType === "dynamic"
    );

  const stories =
    generatedPosts.filter(
      (p) => p.contentType === "story"
    );

  return {
    week: input.weekNumber,

    staticPosts,

    dynamicPosts,

    stories,
  };
}