import type { AgentInput } from "../../types/agent.types.js";
import { generateWeekExecutionRequirements } from "../pipeline/generateWeekExecutionRequirements.js";

export async function retryWeekExecutionRequirements(
  input: AgentInput, week: any, maxRetries = 3
) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Generating week execution requirements attempt ${attempt}`);
      const executionRequirements = await generateWeekExecutionRequirements({
          ...input, week,
      });
      console.log("Week execution requirements generated successfully");

      return executionRequirements;
    } catch (error) {
      console.log("Week execution requirements generation failed. Retrying...");

      if (attempt === maxRetries) {
        console.log("All week execution requirements retries failed");

        throw error;
      }
    }
  }
}