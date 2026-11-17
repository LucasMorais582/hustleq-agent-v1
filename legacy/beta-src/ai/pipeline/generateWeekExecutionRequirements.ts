import type { AgentInput } from "../../types/agent.types.js";

import { promptRouter } from "../composition/promptRouter.js";
import { buildAgentMessages } from "../composition/buildAgentMessages.js";
import { executeAgent } from "../core/executeAgent.js";

type GenerateWeekExecutionRequirementsInput = AgentInput & { week: any };

export async function generateWeekExecutionRequirements(
  input: GenerateWeekExecutionRequirementsInput
) {
  const executionInput: any = {
    ...input,
    mode: "WEEK_EXECUTION_REQUIREMENTS",
    week: input.week,
  };

  const finalPrompt = promptRouter(executionInput);
  const messages = buildAgentMessages(finalPrompt, executionInput);

  const response = await executeAgent({
      messages,
      mode: "WEEK_EXECUTION_REQUIREMENTS",
      model: "gpt-4o",
  });

  const executionMessage = response.find((msg: any) =>
    msg.content?.type === "WEEK_EXECUTION_REQUIREMENTS"
  );

  if (!executionMessage) {
    throw new Error("Week execution requirements were not generated");
  }

  return executionMessage.content.data;
}