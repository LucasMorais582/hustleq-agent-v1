import type { AgentInput }
from "../../types/agent.types.js";

import { generatePostExecution }
from "../pipeline/generatePostExecution.js";

export async function retryPostExecution(
  input: AgentInput,
  concept: any,
  maxRetries = 3
) {
  for (
    let attempt = 1;
    attempt <= maxRetries;
    attempt++
  ) {
    try {
      console.log(
        `Generating execution attempt ${attempt}`
      );

      const execution =
        await generatePostExecution({
          ...input,
          generatedConcept: concept,
        });

      console.log(
        "Execution validated successfully"
      );

      return execution;

    } catch (error) {
      console.log(
        "Invalid execution. Retrying..."
      );

      if (attempt === maxRetries) {
        console.log(
          "All execution retries failed"
        );

        throw error;
      }
    }
  }
}