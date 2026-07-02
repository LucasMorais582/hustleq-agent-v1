import type { AgentInput }
from "../../types/agent.types.js";

import { promptRouter }
from "../composition/promptRouter.js";

import { buildAgentMessages }
from "../composition/buildAgentMessages.js";

import { executeAgent }
from "../core/executeAgent.js";

import { validatePostExecution }
from "../validators/validatePostExecution.js";

type GeneratePostExecutionInput =
  AgentInput & {
    generatedConcept: any;
  };

export async function generatePostExecution(
  input: GeneratePostExecutionInput
) {
  const executionInput: any = {
    ...input,

    mode: "CONTENT_POST_EXECUTION",

    generatedConcept:
      input.generatedConcept,
  };

  const finalPrompt =
    promptRouter(executionInput);

  const messages =
    buildAgentMessages(
      finalPrompt,
      executionInput
    );

  const response =
    await executeAgent({
      messages,
      mode: "CONTENT_POST_EXECUTION",
      model: "gpt-4o",
    });

  const postMessage =
    response.find(
      (msg: any) =>
        msg.content?.type ===
        "CONTENT_POST_EXECUTION"
    );

  const execution =
    postMessage?.content?.data;

  const isValid =
    validatePostExecution(
      execution
    );

  if (!isValid) {
    throw new Error(
      "Generated execution is invalid"
    );
  }

  return execution;
}