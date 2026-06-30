import type { AgentInput }
from "../../types/agent.types.js";

import { promptRouter }
from "../builders/promptRouter.js";

import { buildAgentMessages }
from "../builders/buildAgentMessages.js";

import { executeAgent }
from "../core/executeAgent.js";

import { retrySinglePost }
from "../retries/retrySinglePost.js";

type GenerateSinglePostInput =
  AgentInput & {
    blueprintItem: any;
  };

export async function generateSinglePost(
  input: GenerateSinglePostInput
) {
  return retrySinglePost({
    generator: async () => {

      /*
        Override mode
      */

      const singlePostInput: any = {
        ...input,

        mode: "CONTENT_SINGLE_POST",

        blueprintItem:
          input.blueprintItem,
      };

      /*
        Build prompt
      */

      const finalPrompt =
        promptRouter(
          singlePostInput
        );

      /*
        Build messages
      */

      const messages =
        buildAgentMessages(
          finalPrompt,
          singlePostInput
        );

      /*
        Execute
      */

      const response =
        await executeAgent({
          messages,
          mode: "CONTENT_SINGLE_POST",
          model: "gpt-4o",
        });

      /*
        Extract post
      */

      const postMessage =
        response.find(
          (msg: any) =>
            msg.content?.type ===
            "CONTENT_SINGLE_POST"
        );

      return postMessage?.content?.data;
    }
  });
}