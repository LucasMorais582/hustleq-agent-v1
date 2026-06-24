import { IDEAS_PROMPT } from "../agent/prompts/modes/ideas.prompt.js";
import { ANALYSIS_PROMPT } from "../agent/prompts/modes/analysis.prompt.js";
import { CAPTION_PROMPT } from "../agent/prompts/modes/caption.prompt.js";
import { CONTENT_STRATEGY_PROMPT } from "../agent/prompts/modes/contentStrategy.prompt.js";
import { CONTENT_PLAN_PROMPT } from "../agent/prompts/modes/contentPlan.prompt.js";

import { IDEAS_FORMAT } from "../agent/prompts/format/ideas.format.js";
import { CAPTION_FORMAT } from "../agent/prompts/format/caption.format.js";
import { ANALYSIS_FORMAT } from "../agent/prompts/format/analysis.format.js";
import { BEST_TIME_FORMAT } from "../agent/prompts/format/bestTime.format.js";
import { CONTENT_STRATEGY_FORMAT } from "../agent/prompts/format/contentStrategy.format.js";
import { CONTENT_PLAN_FORMAT } from "../agent/prompts/format/contentPlan.format.js";


export function getModePrompt(mode?: string) {
  switch (mode) {
    case "IDEAS":
      return IDEAS_PROMPT;
    case "ANALYSIS":
      return ANALYSIS_PROMPT;
    case "CAPTION":
      return CAPTION_PROMPT;
    case "CONTENT_STRATEGY":
      return CONTENT_STRATEGY_PROMPT;
    case "CONTENT_PLAN":
      return CONTENT_PLAN_PROMPT;
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
    case "CONTENT_PLAN":
      return CONTENT_PLAN_FORMAT;
    default:
      return ANALYSIS_FORMAT;
  }
}