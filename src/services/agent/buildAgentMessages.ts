import type { AgentInput }
from "../../types/agent.types.js";

import type {
  ChatCompletionMessageParam
}
from "openai/resources";

import { extractLastOutput }
from "../../utils/history.utils.js";

import { shouldIgnoreHistory }
from "./shouldIgnoreHistory.js";

export function buildAgentMessages(
  finalPrompt: string,
  input: AgentInput
): ChatCompletionMessageParam[] {

  const goals =
    input.contentGoals || [];

  const safeHistory =
    (input.history || []).map(
      (msg) => ({
        role: msg.role,
        content:
          typeof msg.content === "string"
            ? msg.content
            : JSON.stringify(msg.content)
      })
    );

  const lastOutput =
    extractLastOutput(
      input.history || []
    );

  const ignoreHistory =
    shouldIgnoreHistory(input);

  const internalModes = [
  "CONTENT_WEEK_BLUEPRINT",
  "CONTENT_SINGLE_POST"
];

  /*
    Internal pipeline calls
  */

  if (internalModes.includes(input.mode || "")) {
    return [
      {
        role: "system",
        content: finalPrompt,
      }
    ];
  }

  /*
    External user calls
  */

  return [
    {
      role: "system",
      content: finalPrompt,
    },

    ...(ignoreHistory
      ? []
      : safeHistory),

    {
      role: "user",
      content: `
        MODE: ${input.mode}

        GOALS:
        ${goals.join(", ")}

        ${
          lastOutput
            ? `
            LAST OUTPUT:
            ${JSON.stringify(lastOutput)}
            `
            : ""
        }

        QUESTION:

        ${input.userMessage}
      `,
    },
  ];
}