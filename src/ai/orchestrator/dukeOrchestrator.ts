import type { AgentInput } from "../../types/agent.types.js";
import { generateWeekPipeline } from "../pipeline/generateWeekPipeline.js";
import { generateBackupPipeline } from "../pipeline/generateBackupPipeline.js";
import { promptRouter } from "../composition/promptRouter.js";
import { buildAgentMessages } from "../composition/buildAgentMessages.js";
import { executeAgent } from "../core/executeAgent.js";

export async function runAgent(input: AgentInput | any) {
  if (input.mode === "CONTENT_WEEK_PIPELINE") {
    const week: any = await generateWeekPipeline(input);

    return [
      {
        role: "assistant",
        content: {
          type: "CONTENT_WEEK_PIPELINE",
          data: week,
        },
      },
    ];
  }

  if (input.mode === "CONTENT_BACKUP_PIPELINE") {
    const backup = await generateBackupPipeline(input);

    return [
      {
        role: "assistant",
        content: {
          type: "CONTENT_BACKUP_PIPELINE",
          data: backup,
        },
      },
    ];
  }

  const modelMap: any = {
    CAPTION: "gpt-4o",
    IDEAS: "gpt-4o",
    ANALYSIS: "gpt-4o",
    BEST_TIME: "gpt-4o",
    CONTENT_STRATEGY: "gpt-4o",
    CONTENT_PLAN: "gpt-4o",
    CONTENT_PLAN_OVERVIEW: "gpt-4o",
    CONTENT_PLAN_WEEK: "gpt-4o",
    CONTENT_PLAN_MODIFICATION: "gpt-4o",
    CONTENT_BACKUP_PIPELINE: "gpt-4o",
    PERSONA: "gpt-4o",
    MARKET_INSIGHTS: "gpt-4o",

    CONTENT_MONTH_STRATEGY: "gpt-4o",
    CONTENT_WEEK_BLUEPRINT: "gpt-4o",
    CONTENT_SINGLE_POST: "gpt-4o",
    CONTENT_WEEK_PIPELINE: "gpt-4o",
  };

  const model = modelMap[input.mode as keyof typeof modelMap] ?? "gpt-4o";
  const finalPrompt = promptRouter(input);
  const messages = buildAgentMessages(finalPrompt, input);


  return executeAgent({
    messages,
    mode: input.mode,
    model,
  });
}