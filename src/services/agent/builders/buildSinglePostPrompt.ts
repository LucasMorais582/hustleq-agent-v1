import type { AgentInput } from "../../../types/agent.types.js";

import { buildBusinessContextPrompt }
from "../../businessContext.service.js";

import {
  getModePrompt,
  getFormatPrompt
}
from "../../../utils/prompt.utils.js";

export function buildSinglePostPrompt(
  input: AgentInput | any
) {
  const contextPrompt =
    buildBusinessContextPrompt(
      input.businessContext
    );

  const modePrompt =
    getModePrompt(
      "CONTENT_SINGLE_POST"
    );

  const formatPrompt =
    getFormatPrompt(
      "CONTENT_SINGLE_POST"
    );

  return `
    ${contextPrompt}

    CONTENT BLUEPRINT:

    ${JSON.stringify(
      input.blueprintItem,
      null,
      2
    )}

    ${modePrompt}

    ${formatPrompt}

    STRICT FINAL INSTRUCTION:

    Return ONLY valid JSON.
  `;
}