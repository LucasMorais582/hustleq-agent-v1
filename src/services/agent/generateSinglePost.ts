import type { AgentInput }
from "../../types/agent.types.js";

import { promptRouter }
from "./builders/promptRouter.js";

import { buildAgentMessages }
from "./buildAgentMessages.js";

import { executeAgent }
from "./executeAgent.js";

type GenerateSinglePostInput =
  AgentInput & {
    blueprintItem: any;
  };

export async function generateSinglePost(
  input: GenerateSinglePostInput
) {
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

  console.log(
    "SINGLE POST MESSAGES:",
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