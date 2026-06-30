import { IDEAS_PROMPT } from "./modes/ideas.prompt.js";
import { ANALYSIS_PROMPT } from "./modes/analysis.prompt.js";
import { CAPTION_PROMPT } from "./modes/caption.prompt.js";
import { CONTENT_STRATEGY_PROMPT } from "./modes/contentStrategy.prompt.js";
import { CONTENT_MONTH_STRATEGY_PROMPT } from "./modes/monthStrategy.prompt.js";
import { buildWeekBlueprintPrompt } from "./modes/weekBlueprint.prompt.js";
import { CONTENT_SINGLE_POST_PROMPT } from "./modes/singlePost.prompt.js";

import { IDEAS_FORMAT } from "./format/ideas.format.js";
import { CAPTION_FORMAT } from "./format/caption.format.js";
import { ANALYSIS_FORMAT } from "./format/analysis.format.js";
import { BEST_TIME_FORMAT } from "./format/bestTime.format.js";
import { CONTENT_STRATEGY_FORMAT } from "./format/contentStrategy.format.js";
import { CONTENT_MONTH_STRATEGY_FORMAT } from "./format/monthStrategy.format.js";
import { CONTENT_WEEK_BLUEPRINT_FORMAT } from "./format/weekBlueprint.format.js";
import { CONTENT_SINGLE_POST_FORMAT } from "./format/singlePost.format.js";
import type { AgentInput } from "../../types/agent.types.js";

export function getModePrompt(input?: AgentInput, mode?: string) {
  const contentMode = mode ? mode : input?.mode;
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
    case "CONTENT_SINGLE_POST":
      return CONTENT_SINGLE_POST_PROMPT;
    case "CONTENT_WEEK_BLUEPRINT":
      return buildWeekBlueprintPrompt(input?.planConfig);
    case "CONTENT_PLAN_BACKUP":
    default:
      return "";
  }
}

export function getFormatPrompt(mode?: string) {
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
    case "CONTENT_SINGLE_POST":
      return CONTENT_SINGLE_POST_FORMAT;
    case "CONTENT_WEEK_BLUEPRINT":
      return CONTENT_WEEK_BLUEPRINT_FORMAT;
    default:
      return ANALYSIS_FORMAT;
  }
}