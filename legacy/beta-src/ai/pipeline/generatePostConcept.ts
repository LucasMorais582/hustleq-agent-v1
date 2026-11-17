import type { AgentInput }
from "../../types/agent.types.js";

import { promptRouter }
from "../composition/promptRouter.js";

import { buildAgentMessages }
from "../composition/buildAgentMessages.js";

import { executeAgent }
from "../core/executeAgent.js";

import { validatePostConcept }
from "../validators/validatePostConcept.js";

type GeneratePostConceptInput =
  AgentInput & {
    blueprintItem: any;
  };

export async function generatePostConcept(
  input: GeneratePostConceptInput
) {
  const conceptInput: any = {
    ...input,

    mode: "CONTENT_POST_CONCEPT",

    blueprintItem:
      input.blueprintItem,
  };

  const finalPrompt =
    promptRouter(conceptInput);

  const messages =
    buildAgentMessages(
      finalPrompt,
      conceptInput
    );

  const response =
    await executeAgent({
      messages,
      mode: "CONTENT_POST_CONCEPT",
      model: "gpt-4o",
    });

  const postMessage =
    response.find(
      (msg: any) =>
        msg.content?.type ===
        "CONTENT_POST_CONCEPT"
    );

  const concept =
    postMessage?.content?.data;

  const isValid =
    validatePostConcept(
      concept
    );

  if (!isValid) {
    throw new Error(
      "Generated concept is invalid"
    );
  }

  return concept;
}