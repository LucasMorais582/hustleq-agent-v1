import type { AgentInput }
from "../../types/agent.types.js";

import { buildBusinessContextPrompt }
from "../../services/businessContext.service.js";

import {
  getModePrompt,
  getFormatPrompt
}
from "../prompts/promptRegistry.js";

import { promptComposer }
from "./promptComposer.js";

export function buildPostExecutionPrompt(
  input: AgentInput | any
) {
  const contextPrompt =
    buildBusinessContextPrompt(
      input.businessContext
    );

  const modePrompt =
    getModePrompt(
      undefined,
      "CONTENT_POST_EXECUTION"
    );

  const formatPrompt =
    getFormatPrompt(
      "CONTENT_POST_EXECUTION"
    );

  const extraContext = `
    POST IDEA:

    ${JSON.stringify(
        input.generatedConcept?.idea,
        null,
        2
    )}

    CREATIVE DIRECTION:

    ${JSON.stringify(
        input.generatedConcept?.creativeDirection,
        null,
        2
    )}
    `;

  return promptComposer({
    sections: [
      contextPrompt,
      extraContext,
      modePrompt,
      formatPrompt,
    ]
  });
}