import type { AgentInput } from "../../types/agent.types.js";
import { buildDefaultPrompt } from "./buildDefaultPrompt.js";
import { buildBlueprintPrompt } from "./buildBlueprintPrompt.js";
import { buildPostConceptPrompt } from "./buildPostConceptPrompt.js";
import { buildPostExecutionPrompt } from "./buildPostExecutionPrompt.js";
import { buildWeekExecutionRequirementsPrompt } from "./buildWeekExecutionRequirementsPrompt.js";

export function promptRouter(input: AgentInput) {
  switch (input.mode) {
    case "CONTENT_WEEK_BLUEPRINT":
    case "CONTENT_BACKUP_PIPELINE":
      return buildBlueprintPrompt(input);

    case "CONTENT_POST_CONCEPT":
      return buildPostConceptPrompt(input);

    case "CONTENT_POST_EXECUTION":
      return buildPostExecutionPrompt(input);

    case "WEEK_EXECUTION_REQUIREMENTS":
      return buildWeekExecutionRequirementsPrompt(input);

    default:
      return buildDefaultPrompt(input);
  }
}