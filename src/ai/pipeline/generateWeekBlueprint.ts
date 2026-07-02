import type { AgentInput } from "../../types/agent.types.js";

import { promptRouter } from "../composition/promptRouter.js";

import { buildAgentMessages }from "../composition/buildAgentMessages.js";

import { executeAgent } from "../core/executeAgent.js";
import { retryWeekBlueprint }
from "../retries/retryWeekBlueprint.js";

export async function generateWeekBlueprint(
  input: AgentInput
) {
  return retryWeekBlueprint({
    generator: async () => {

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
        promptRouter(
          blueprintInput
        );

      /*
        Build messages
      */

      const messages =
        buildAgentMessages(
          finalPrompt,
          blueprintInput
        );

      /*
        Execute
      */

      const response =
        await executeAgent({
          messages,
          mode:
            "CONTENT_WEEK_BLUEPRINT",
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

      return blueprintMessage
        ?.content?.data;
    }
  });
}