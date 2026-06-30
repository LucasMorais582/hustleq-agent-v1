import type { AgentInput } from "../../types/agent.types.js";

import { BASE_PROMPT }
from "../prompts/base.prompt.js";

import { buildBusinessContextPrompt }
from "../../services/businessContext.service.js";

import {
  getModePrompt,
  getFormatPrompt
}
from "../prompts/promptRegistry.js";

import { getStrategyPrompt }
from "../prompts/modes/strategy.prompt.js";

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
    getModePrompt(input);

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