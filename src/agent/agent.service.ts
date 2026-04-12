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

function getModePrompt(mode?: string) {
  switch (mode) {
    case "IDEAS":
      return IDEAS_PROMPT;
    case "ANALYSIS":
      return ANALYSIS_PROMPT;
    case "CAPTION":
      return CAPTION_PROMPT;
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

  const systemPrompt = `
    ${BASE_PROMPT}

    ${STYLE_PROMPT}

    ${getModePrompt(input.mode)}

    ${getGoalInstruction(input.contentGoal)}

    ${getFormatPrompt(input.mode)}

    IMPORTANT:

    You must strictly follow the response format.

    Do NOT include any fields that are not explicitly requested.

    If the mode is CAPTION, return ONLY caption fields.
    If the mode is IDEAS, return ONLY ideas.
    If the mode is ANALYSIS, return ONLY analysis fields.
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

        DADOS:
        ${JSON.stringify(input.instagramData)}

        CONTEXTO:
        ${JSON.stringify(input.businessContext)}

        PERGUNTA:
        ${input.userMessage}
      `,
    },
  ];

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages,
    temperature: 0.7,
  });

  const content = response.choices[0]?.message.content ?? "";

  let parsed;

  try {
    parsed = JSON.parse(content || "{}");
  } catch {
    parsed = { raw: content };
  }

  return parsed;
}