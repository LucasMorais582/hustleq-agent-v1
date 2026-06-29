import type { AgentInput } from "../../../types/agent.types.js";

import { BASE_PROMPT }
from "../../../agent/prompts/base.prompt.js";

import { buildBusinessContextPrompt }
from "../../businessContext.service.js";

import {
  getModePrompt,
  getFormatPrompt
}
from "../../../utils/prompt.utils.js";

import { getStrategyPrompt }
from "../../../agent/prompts/modes/strategy.prompt.js";

export function buildBlueprintPrompt(
  input: AgentInput
) {
  const contextPrompt =
    buildBusinessContextPrompt(
      input.businessContext
    );

  const strategyPrompt =
    getStrategyPrompt(input);

  const modePrompt =
    getModePrompt(
      "CONTENT_WEEK_BLUEPRINT"
    );

  const formatPrompt =
    getFormatPrompt(
      "CONTENT_WEEK_BLUEPRINT"
    );

  return `
    ${BASE_PROMPT}

    ${contextPrompt}

    ${strategyPrompt}

    ${modePrompt}

    ${formatPrompt}

    STRICT FINAL INSTRUCTION:

    Return ONLY valid JSON.
  `;
}