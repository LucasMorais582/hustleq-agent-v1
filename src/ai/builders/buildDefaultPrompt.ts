import type { AgentInput } from "../../types/agent.types.js";

import { BASE_PROMPT } from "../prompts/base.prompt.js";
import { STYLE_PROMPT } from "../prompts/style.prompt.js";
import { systemPrompt } from "../prompts/system.prompt.js";

import { buildBusinessContextPrompt } from "../../services/businessContext.service.js";

import { getStrategyPrompt } from "../prompts/modes/strategy.prompt.js";

import {
  getModePrompt,
  getFormatPrompt
} from "../prompts/promptRegistry.js";

import { getPlanConfigPrompt }
from "../prompts/modes/planConfig.prompt.js";

import { getGoalsInstructionPrompt }
from "../prompts/modes/goals.prompt.js";

import { getExtraContext }
from "./getExtraContext.js";

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

  return `
    ${BASE_PROMPT}

    ${STYLE_PROMPT}

    ${contextPrompt}

    ${strategyPrompt}

    ${planConfigPrompt}

    ${modePrompt}

    ${extraContext}

    ${goalsPrompt}

    ${formatPrompt}

    ${systemPrompt}

    STRICT FINAL INSTRUCTION:

    - Return ONLY valid JSON
    - Do NOT include any explanation
    - Do NOT include any text before or after JSON
  `;
}