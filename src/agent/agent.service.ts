import OpenAI from "openai";
import type { AgentInput } from "../types/agent.types.js";

import { BASE_PROMPT } from "./prompts/base.prompt.js";
import { STYLE_PROMPT } from "./prompts/style.prompt.js";

import { IDEAS_PROMPT } from "./prompts/modes/ideas.prompt.js";
import { ANALYSIS_PROMPT } from "./prompts/modes/analysis.prompt.js";
import { CAPTION_PROMPT } from "./prompts/modes/caption.prompt.js";

import type { ChatCompletionMessageParam } from "openai/resources";

import { IDEAS_FORMAT } from "./prompts/format/ideas.format.js";
import { CAPTION_FORMAT } from "./prompts/format/caption.format.js";
import { ANALYSIS_FORMAT } from "./prompts/format/analysis.format.js";
import { BEST_TIME_FORMAT } from "./prompts/format/bestTime.format.js";
import { CONTENT_STRATEGY_PROMPT } from "./prompts/modes/contentStrategy.prompt.js";

import { buildBusinessContextPrompt } from "../services/businessContext.service.js";

function getModePrompt(mode?: string) {
  switch (mode) {
    case "IDEAS":
      return IDEAS_PROMPT;
    case "ANALYSIS":
      return ANALYSIS_PROMPT;
    case "CAPTION":
      return CAPTION_PROMPT;
    case "CONTENT_STRATEGY":
      return CONTENT_STRATEGY_PROMPT;
    default:
      return "";
  }
}

function getFormatPrompt(mode?: string) {
  switch (mode) {
    case "IDEAS":
      return IDEAS_FORMAT;
    case "CAPTION":
      return CAPTION_FORMAT;
    case "ANALYSIS":
      return ANALYSIS_FORMAT;
    case "BEST_TIME":
      return BEST_TIME_FORMAT;
    default:
      return ANALYSIS_FORMAT;
  }
}

function getGoalInstruction(goal?: string) {
  switch (goal) {
    case "ENGAGEMENT":
      return `
        FOCUS: Engagement

        - Prioritize comments, shares and interaction
        - Use questions when appropriate
        - Encourage users to respond
      `;

    case "CONVERSION":
      return `
      FOCUS: Conversion

      - Drive action (buy, click, message)
      - Use strong and clear CTA
      - Highlight value and urgency when relevant
    `;

    case "EDUCATIONAL":
      return `
      FOCUS: Educational

      - Teach something useful
      - Be clear and structured
      - Deliver value before asking for action
    `;

    default:
      return `
      FOCUS: General marketing performance
    `;
  }
}

export async function runAgent(input: AgentInput) {
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const contextPrompt = buildBusinessContextPrompt(input.businessContext);

  const systemPrompt = `
    ${BASE_PROMPT}

    ${STYLE_PROMPT}

    ${contextPrompt}

    ${getModePrompt(input.mode)}

    ${getGoalInstruction(input.contentGoal)}

    ${getFormatPrompt(input.mode)}

    IMPORTANT:

    You must strictly follow the response format.

    Do NOT include any fields that are not explicitly requested.

    If the mode is CAPTION, return ONLY caption fields.
    If the mode is IDEAS, return ONLY ideas.
    If the mode is ANALYSIS, return ONLY analysis fields.

    BUSINESS CONTEXT RULES (CRITICAL):

    - Treat the business context as the user's current understanding, not absolute truth
    - Do NOT blindly follow it if better alternatives exist
    - Suggest improvements when relevant
    - Challenge weak assumptions respectfully
    - Ask clarifying questions when information is missing or unclear
    - Provide best-guess outputs when needed and explain what could improve accuracy
    - Always prioritize real outcomes (leads, sales, conversions) over vanity metrics

    CRITICAL:

    When a JSON format is required:
    - Return ONLY JSON
    - Do NOT use markdown
    - Do NOT wrap in code blocks
  `;

  const safeHistory = (input.history || []).map((msg) => ({
    role: msg.role,
    content:
      typeof msg.content === "string"
        ? msg.content
        : JSON.stringify(msg.content),
  }));

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },

    ...safeHistory,

    {
      role: "user",
      content: `
        MODE: ${input.mode}
        GOAL: ${input.contentGoal}

        Follow strictly the required JSON format for this mode.

        DATA:
        ${JSON.stringify(input.instagramData)}

        QUESTION:
        ${input.userMessage}
      `,
    },
  ];

  const modelMap: any = {
    CAPTION: "gpt-4o",
    IDEAS: "gpt-4o",
    ANALYSIS: "gpt-4o",
    BEST_TIME: "gpt-4o",
    CONTENT_STRATEGY: "gpt-4o",
    PERSONA: "gpt-4o",
    MARKET_INSIGHTS: "gpt-4o"
  };

  const model = modelMap[input.mode as keyof typeof modelMap] ?? "gpt-4o";

  const response = await openai.chat.completions.create({
    model,
    messages,
    temperature: 0.7,
  });
  
  console.log({
    tokens: response.usage,
  });

  const content = response.choices[0]?.message.content ?? "";
  const cleaned = content
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();

  let parsed;

  try {
    parsed = JSON.parse(cleaned);
  } catch {
    console.error("JSON parse failed:", cleaned);
    parsed = { raw: cleaned };
  }

  return parsed;
}