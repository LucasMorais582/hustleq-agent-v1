import OpenAI from "openai";
import type { AgentInput } from "../types/agent.types.js";
import type { ChatCompletionMessageParam } from "openai/resources";

import { BASE_PROMPT } from "./prompts/base.prompt.js";
import { STYLE_PROMPT } from "./prompts/style.prompt.js";

import { buildBusinessContextPrompt } from "../services/businessContext.service.js";

import { systemPrompt } from "./prompts/system.prompt.js";
import { getStrategyPrompt } from "./prompts/modes/strategy.prompt.js";
import { getModePrompt, getFormatPrompt } from "../utils/prompt.utils.js";
import { getPlanConfigPrompt } from "./prompts/modes/planConfig.prompt.js";
import { getGoalsInstructionPrompt } from "./prompts/modes/goals.prompt.js";
import { extractLastOutput } from "../utils/history.utils.js";

export async function runAgent(input: AgentInput) {
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const goals = input.contentGoals?.length
    ? input.contentGoals
    : input.contentGoal
      ? [input.contentGoal]
      : [];

  const goalsPrompt = getGoalsInstructionPrompt(goals);
  const contextPrompt = buildBusinessContextPrompt(input.businessContext);
  const strategyPrompt = getStrategyPrompt(input);
  const planConfigPrompt = getPlanConfigPrompt(input);

  const finalPrompt = `
    ${BASE_PROMPT}

    ${STYLE_PROMPT}

    ${contextPrompt}

    ${strategyPrompt}

    ${planConfigPrompt}

    ${getModePrompt(input.mode)}

    ${goalsPrompt}

    ${getFormatPrompt(input.mode)}

    ${systemPrompt}

    STRICT FINAL INSTRUCTION:

    - Return ONLY valid JSON
    - Do NOT include any explanation
    - Do NOT include any text before or after JSON
    - If you break this rule, your response is INVALID
  `;

  const safeHistory = (input.history || []).map((msg) => ({
    role: msg.role,
    content:
      typeof msg.content === "string"
        ? msg.content
        : JSON.stringify(msg.content),
  }));

  const lastOutput = extractLastOutput(input.history || []);

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: finalPrompt },

    ...safeHistory,

    {
      role: "user",
      content: `
        MODE: ${input.mode}
        GOALS: ${goals.join(", ")} 
        
        ${lastOutput ? `
          LAST_OUTPUT:
          ${JSON.stringify(lastOutput)}
          ` : ""}

        Follow strictly the required JSON format for this mode.

        DATA:
        ${JSON.stringify(input.instagramData)}

        QUESTION:
        ${input.userMessage}
      `,
    }
  ];

  const modelMap: any = {
    CAPTION: "gpt-4o",
    IDEAS: "gpt-4o",
    ANALYSIS: "gpt-4o",
    BEST_TIME: "gpt-4o",
    CONTENT_STRATEGY: "gpt-4o",
    CONTENT_PLAN: "gpt-4o",
    PERSONA: "gpt-4o",
    MARKET_INSIGHTS: "gpt-4o"
  };

  const model = modelMap[input.mode as keyof typeof modelMap] ?? "gpt-4o";

  const response = await openai.chat.completions.create({
    model,
    messages,
    temperature: 0.7,
  });

  const content = response.choices[0]?.message.content ?? "";
  const cleaned = content.replace(/```json/g, "").replace(/```/g, "").trim();

  let parsed;

  try {
    parsed = JSON.parse(cleaned);
  } catch {
    try {
      const start = cleaned.indexOf("{");
      const end = cleaned.lastIndexOf("}");

      const jsonString = cleaned.slice(start, end + 1);
      parsed = JSON.parse(jsonString);
    } catch {
      console.error("JSON parse failed:", cleaned);
      parsed = { raw: cleaned };
    }
  }

  if (parsed?.ideas) {
    // modelo voltou formato antigo → corrigimos
    parsed = {
      text: "Here are some ideas based on your request.",
      data: {
        type: input.mode,
        data: parsed,
      },
    };
  }

  if (parsed?.text && parsed?.data) {
    return [
      {
        role: "assistant",
        content: {
          type: "TEXT",
          data: {
            text: parsed.text,
          },
        },
      },
      {
        role: "assistant",
        content: parsed.data,
      },
    ];
  }

  // fallback (caso modelo não siga formato)
  return [
    {
      role: "assistant",
      content: parsed,
    },
  ];
}