import type { AgentInput }
from "../../types/agent.types.js";

import { generatePostConcept }
from "../pipeline/generatePostConcept.js";

export async function retryPostConcept(
  input: AgentInput,
  item: any,
  maxRetries = 3
) {
  for (
    let attempt = 1;
    attempt <= maxRetries;
    attempt++
  ) {
    try {
      console.log(
        `Generating concept attempt ${attempt}`
      );

      const concept =
        await generatePostConcept({
          ...input,
          blueprintItem: item,
        });

      console.log(
        "Concept validated successfully"
      );

      return concept;

    } catch (error) {
      console.log(
        "Invalid concept. Retrying..."
      );

      if (attempt === maxRetries) {
        console.log(
          "All concept retries failed"
        );

        throw error;
      }
    }
  }
}