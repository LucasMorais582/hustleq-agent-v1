import type { AgentInput } from "../../types/agent.types.js";

import { promptRouter }
from "./builders/promptRouter.js";

import { buildAgentMessages }
from "./buildAgentMessages.js";

import { executeAgent }
from "./executeAgent.js";

export async function generateWeekBlueprint(
  input: AgentInput
) {
  /*
    Override mode
  */

  const blueprintInput: any = {
    ...input,
    mode: "CONTENT_WEEK_BLUEPRINT",
  };

  /*
    Build prompt
  */

  const finalPrompt =
    promptRouter(blueprintInput);

  /*
    Build messages
  */

  const messages =
    buildAgentMessages(
      finalPrompt,
      blueprintInput
    );

  console.log(
    "BLUEPRINT INPUT:",
    JSON.stringify(
      blueprintInput,
      null,
      2
    )
  );

  console.log(
    "BLUEPRINT MESSAGES:",
    JSON.stringify(
      messages,
      null,
      2
    )
  );

  /*
    Execute
  */

  const response =
    await executeAgent({
      messages,
      mode: "CONTENT_WEEK_BLUEPRINT",
      model: "gpt-4o",
    });

  /*
    Extract blueprint
  */

  const blueprintMessage =
    response.find(
      (msg: any) =>
        msg.content?.type ===
        "CONTENT_WEEK_BLUEPRINT"
    );

  return blueprintMessage?.content?.data;
}