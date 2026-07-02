import { IDEAS_PROMPT } from "./tasks/ideas.prompt.js";
import { ANALYSIS_PROMPT } from "./tasks/analysis.prompt.js";
import { CAPTION_PROMPT } from "./tasks/caption.prompt.js";
import { CONTENT_STRATEGY_PROMPT } from "./tasks/contentStrategy.prompt.js";
import { CONTENT_MONTH_STRATEGY_PROMPT } from "./tasks/monthStrategy.prompt.js";
import { buildWeekBlueprintPrompt } from "./tasks/weekBlueprint.prompt.js";
import { CONTENT_POST_CONCEPT_PROMPT } from "./tasks/postConcept.prompt.js";
import { CONTENT_POST_EXECUTION_PROMPT } from "./tasks/postExecution.prompt.js";

import { IDEAS_FORMAT } from "./schemas/ideas.format.js";
import { CAPTION_FORMAT } from "./schemas/caption.format.js";
import { ANALYSIS_FORMAT } from "./schemas/analysis.format.js";
import { BEST_TIME_FORMAT } from "./schemas/bestTime.format.js";
import { CONTENT_STRATEGY_FORMAT } from "./schemas/contentStrategy.format.js";
import { CONTENT_MONTH_STRATEGY_FORMAT } from "./schemas/monthStrategy.format.js";
import { CONTENT_WEEK_BLUEPRINT_FORMAT } from "./schemas/weekBlueprint.format.js";
import { CONTENT_POST_CONCEPT_FORMAT } from "./schemas/postConcept.format.js";
import { CONTENT_POST_EXECUTION_FORMAT } from "./schemas/postExecution.format.js";

import type { AgentInput }
from "../../types/agent.types.js";

export function getModePrompt(
  input?: AgentInput,
  mode?: string
) {
  const contentMode =
    mode ? mode : input?.mode;

  switch (contentMode) {
    case "IDEAS":
      return IDEAS_PROMPT;

    case "ANALYSIS":
      return ANALYSIS_PROMPT;

    case "CAPTION":
      return CAPTION_PROMPT;

    case "CONTENT_STRATEGY":
      return CONTENT_STRATEGY_PROMPT;

    case "CONTENT_MONTH_STRATEGY":
      return CONTENT_MONTH_STRATEGY_PROMPT;

    case "CONTENT_WEEK_BLUEPRINT":
      return buildWeekBlueprintPrompt(
        input?.planConfig
      );

    case "CONTENT_POST_CONCEPT":
      return CONTENT_POST_CONCEPT_PROMPT;

    case "CONTENT_POST_EXECUTION":
      return CONTENT_POST_EXECUTION_PROMPT;

    case "CONTENT_PLAN_BACKUP":
    default:
      return "";
  }
}

export function getFormatPrompt(
  mode?: string
) {
  switch (mode) {
    case "IDEAS":
      return IDEAS_FORMAT;

    case "CAPTION":
      return CAPTION_FORMAT;

    case "ANALYSIS":
      return ANALYSIS_FORMAT;

    case "BEST_TIME":
      return BEST_TIME_FORMAT;

    case "CONTENT_STRATEGY":
      return CONTENT_STRATEGY_FORMAT;

    case "CONTENT_MONTH_STRATEGY":
      return CONTENT_MONTH_STRATEGY_FORMAT;

    case "CONTENT_WEEK_BLUEPRINT":
      return CONTENT_WEEK_BLUEPRINT_FORMAT;

    case "CONTENT_POST_CONCEPT":
      return CONTENT_POST_CONCEPT_FORMAT;

    case "CONTENT_POST_EXECUTION":
      return CONTENT_POST_EXECUTION_FORMAT;

    default:
      return ANALYSIS_FORMAT;
  }
}