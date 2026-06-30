import type { AgentInput }
from "../../types/agent.types.js";

import { buildDefaultPrompt }
from "./buildDefaultPrompt.js";

import { buildBlueprintPrompt }
from "./buildBlueprintPrompt.js";

import { buildSinglePostPrompt }
from "./buildSinglePostPrompt.js";

export function promptRouter(
  input: AgentInput
) {
  switch (input.mode) {
    case "CONTENT_WEEK_BLUEPRINT":
      return buildBlueprintPrompt(input);

    case "CONTENT_SINGLE_POST":
      return buildSinglePostPrompt(input);

    default:
      return buildDefaultPrompt(input);
  }
}