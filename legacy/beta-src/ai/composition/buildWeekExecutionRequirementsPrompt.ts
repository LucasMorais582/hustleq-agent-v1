import type { AgentInput } from "../../types/agent.types.js";
import { buildBusinessContextPrompt } from "../../services/businessContext.service.js";
import {getModePrompt, getFormatPrompt } from "../prompts/promptRegistry.js";
import { promptComposer } from "./promptComposer.js";

export function buildWeekExecutionRequirementsPrompt(input: AgentInput | any) {
  
  const contextPrompt = buildBusinessContextPrompt(input.businessContext);
  const formatPrompt = getFormatPrompt("WEEK_EXECUTION_REQUIREMENTS");
  const modePrompt = getModePrompt(undefined, "WEEK_EXECUTION_REQUIREMENTS");
  
  const extraContext = `
    COMPLETED CONTENT WEEK
    Analyze the following completed week.
    Do NOT rewrite any content.
    Use it only as context to generate the consolidated production preparation.

    ${JSON.stringify({
        week: input.week?.week,
        staticPosts: input.week?.staticPosts,
        dynamicPosts: input.week?.dynamicPosts,
        stories: input.week?.stories,
      }, null, 2
    )}
  `;

  return promptComposer({
    sections: [
      contextPrompt,
      extraContext,
      modePrompt,
      formatPrompt,
    ],
  });
}