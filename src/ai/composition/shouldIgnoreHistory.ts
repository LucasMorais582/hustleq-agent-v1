import type { AgentInput } from "../../types/agent.types.js";

export function shouldIgnoreHistory(input: AgentInput) {
  const ignoredModes = [
    "CONTENT_PLAN_OVERVIEW",
    "CONTENT_PLAN_WEEK",
    "CONTENT_PLAN_MODIFICATION",
    "CONTENT_PLAN_BACKUP",
  ];

  return ignoredModes.includes(
    input.mode as string
  );
}