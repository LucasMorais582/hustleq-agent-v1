import type { AgentInput } from "../../types/agent.types.js";

import { buildBusinessContextPrompt }
from "../../services/businessContext.service.js";

import {
  getModePrompt,
  getFormatPrompt
}
from "../prompts/promptRegistry.js";

import { getStrategyPrompt }
from "../prompts/layers/strategy.prompt.js";

import { promptComposer }
from "./promptComposer.js";

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

  return promptComposer({
      sections: [
        contextPrompt,
        strategyPrompt,
        modePrompt,
        formatPrompt,
      ]
    });
}