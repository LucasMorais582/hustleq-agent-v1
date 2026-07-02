import type { AgentInput } from "../../types/agent.types.js";

export function getExtraContext(input: AgentInput) {
  switch (input.mode) {
    case "CONTENT_PLAN_WEEK":
        return `
            WEEK NUMBER: ${input.weekNumber}

            MONTHLY STRATEGY:
            ${JSON.stringify(
                input.monthlyOverview
            )}

            PREVIOUS GENERATED WEEKS:
            ${JSON.stringify(
                input.generatedWeeks || []
            )}
        `;

    case "CONTENT_PLAN_MODIFICATION":
        return `
            PREVIOUS WEEK:
            ${JSON.stringify(
                input.previousWeek
            )}

            USER REQUEST:
            ${input.userFeedback}
        `;

    case "CONTENT_PLAN_OVERVIEW":
        return `
            Generate monthly content strategy based on the selected content strategy.

            SELECTED STRATEGY:

            ${JSON.stringify(
                input.strategy
            )}
        `;

    case "CONTENT_WEEK_BLUEPRINT":
        return `
            WEEK NUMBER: ${input.weekNumber}

            CONTENT STRATEGY:

            ${JSON.stringify(
                input.strategy
            )}

            IMPORTANT:

            You have multiple strategic pillars.

            You must mix different strategic topics across the week.

            Do NOT dedicate the entire week to one pillar.

            Different posts should explore different business angles.

            PLAN CONFIGURATION:

            ${JSON.stringify(
                input.planConfig
            )}
        `;

    case "CONTENT_SINGLE_POST":
        return `
            You must generate ONE COMPLETE social media content.

            CONTENT BLUEPRINT:

            ${JSON.stringify(
            input.blueprintItem
            )}

            BUSINESS CONTEXT:

            ${JSON.stringify(
            input.businessContext
            )}

            STRATEGIC CONTEXT:

            ${JSON.stringify(
            input.monthlyOverview
            )}

            IMPORTANT:

            You are generating ONLY ONE content piece.

            You must fully expand this blueprint into production-ready content.

            Do not generate multiple posts.

            Respect the blueprint direction strictly.
        `;

    default:
      return "";
  }
}