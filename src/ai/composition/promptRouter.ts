import type { AgentInput }
from "../../types/agent.types.js";

import { buildDefaultPrompt }
from "./buildDefaultPrompt.js";

import { buildBlueprintPrompt }
from "./buildBlueprintPrompt.js";

import { buildPostConceptPrompt }
from "./buildPostConceptPrompt.js";

import { buildPostExecutionPrompt }
from "./buildPostExecutionPrompt.js";

export function promptRouter(
  input: AgentInput
) {
  switch (input.mode) {
    case "CONTENT_WEEK_BLUEPRINT":
      return buildBlueprintPrompt(input);

    case "CONTENT_POST_CONCEPT":
      return buildPostConceptPrompt(input);

    case "CONTENT_POST_EXECUTION":
      return buildPostExecutionPrompt(input);

    default:
      return buildDefaultPrompt(input);
  }
}