import type { AgentInput } from "../../types/agent.types.js";

import { BASE_PROMPT }
from "../prompts/shared/base.prompt.js";

import { STYLE_PROMPT }
from "../prompts/shared/style.prompt.js";

import { systemPrompt }
from "../prompts/shared/system.prompt.js";

import { buildBusinessContextPrompt }
from "../../services/businessContext.service.js";

import { getStrategyPrompt }
from "../prompts/layers/strategy.prompt.js";

import {
  getModePrompt,
  getFormatPrompt
} from "../prompts/promptRegistry.js";

import { getPlanConfigPrompt }
from "../prompts/layers/planConfig.prompt.js";

import { getGoalsInstructionPrompt }
from "../prompts/layers/goals.prompt.js";

import { getExtraContext }
from "./getExtraContext.js";

import { promptComposer }
from "./promptComposer.js";

export function buildDefaultPrompt(
  input: AgentInput
) {
  const goals =
    input.contentGoals?.length
      ? input.contentGoals
      : input.contentGoal
      ? [input.contentGoal]
      : [];

  const goalsPrompt =
    getGoalsInstructionPrompt(goals);

  const contextPrompt =
    buildBusinessContextPrompt(
      input.businessContext
    );

  const strategyPrompt =
    getStrategyPrompt(input);

  const planConfigPrompt =
    getPlanConfigPrompt(input);

  const modePrompt =
    getModePrompt(input);

  const formatPrompt =
    getFormatPrompt(input.mode);

  const extraContext =
    getExtraContext(input);

  return promptComposer({
    sections: [
      BASE_PROMPT,
      STYLE_PROMPT,
      contextPrompt,
      strategyPrompt,
      planConfigPrompt,
      modePrompt,
      extraContext,
      goalsPrompt,
      formatPrompt,
      systemPrompt,
    ]
  });
}