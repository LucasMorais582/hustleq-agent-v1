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

export function buildPostConceptPrompt(
  input: AgentInput | any
) {
  const contextPrompt =
    buildBusinessContextPrompt(
      input.businessContext
    );

  const modePrompt =
    getModePrompt(
      undefined,
      "CONTENT_POST_CONCEPT"
    );

  const formatPrompt =
    getFormatPrompt(
      "CONTENT_POST_CONCEPT"
    );

  const extraContext = `
    CONTENT BLUEPRINT:

    ${JSON.stringify(
      input.blueprintItem,
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