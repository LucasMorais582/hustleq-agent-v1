import type { AgentInput }
from "../../types/agent.types.js";

import { generateWeekBlueprint }
from "./generateWeekBlueprint.js";

import { generateSinglePost }
from "./generateSinglePost.js";

import { validateWeekPipeline }
from "../validators/validateWeekPipeline.js";

export async function generateWeekPipeline(
  input: AgentInput
) {
  /*
    STEP 1
  */
  const blueprint = await generateWeekBlueprint(input);
  if (!blueprint || !blueprint.blueprint || !Array.isArray(blueprint.blueprint)) {
    throw new Error(
      "Invalid blueprint response"
    );
  }

  console.log(
    "BLUEPRINT GENERATED:",
    JSON.stringify(
      blueprint,
      null,
      2
    )
  );

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

  const week = {
    week: input.weekNumber,
    staticPosts,
    dynamicPosts,
    stories,
  };

  const isValid = validateWeekPipeline(week, input.planConfig);
  if (!isValid) {
    throw new Error(
      "Generated week pipeline is invalid"
    );
  }

  return week;
}