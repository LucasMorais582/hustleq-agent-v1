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
import { CONTENT_STRATEGY_FORMAT } from "./prompts/format/contentStrategy.format.js";
import { systemPrompt } from "./prompts/system.prompt.js";
import { CONTENT_PLAN_PROMPT } from "./prompts/modes/contentPlan.prompt.js";
import { CONTENT_PLAN_FORMAT } from "./prompts/format/contentPlan.format.js";

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
    case "CONTENT_PLAN":
      return CONTENT_PLAN_PROMPT;
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
    case "CONTENT_STRATEGY":
      return CONTENT_STRATEGY_FORMAT;
    case "CONTENT_PLAN":
      return CONTENT_PLAN_FORMAT;
    default:
      return ANALYSIS_FORMAT;
  }
}

function getGoalsInstruction(goals?: string[]) {
  if (!goals || goals.length === 0) return "";

  const goalDescriptions: Record<string, string> = {
    ENGAGEMENT: `
      - Focus on comments, shares and interaction
      - Use questions when appropriate
      - Encourage users to respond
      `,
          CONVERSION: `
      - Drive action (buy, click, message)
      - Use strong and clear CTA
      - Highlight value and urgency
      `,
          EDUCATIONAL: `
      - Teach something useful
      - Be clear and structured
      - Deliver value before asking for action
      `,
          BRAND: `
      - Strengthen brand perception
      - Highlight positioning and identity
      - Build emotional connection
      `,
          STORYTELLING: `
      - Tell relatable or emotional stories
      - Use narrative structure
      - Create connection with audience
      `
        };

        return `
      CONTENT GOALS:

      You must consider the following goals:

      ${goals.map(g => `- ${g}`).join("\n")}

      GOAL EXECUTION RULES:

      ${goals
        .map(g => `Goal: ${g}\n${goalDescriptions[g] || ""}`)
        .join("\n")}

      DISTRIBUTION RULE:

      - Each content item should prioritize ONE primary goal
      - Do NOT try to satisfy all goals in a single post
      - Across the full plan, ALL goals must be represented
      - Distribute goals across different posts

      Example:

      Post 1 → ENGAGEMENT  
      Post 2 → CONVERSION  
      Post 3 → EDUCATIONAL  
      Post 4 → BRAND  
    `;
}

function extractLastOutput(history: any[]) {
  if (!history || history.length === 0) return null;

  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];

    if (msg.role !== "assistant") continue;

    try {
      const parsed = JSON.parse(msg.content);

      if (parsed?.type && parsed?.data) {
        return parsed;
      }

    } catch {
      continue;
    }
  }

  return null;
}

export async function runAgent(input: AgentInput) {
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const goals = input.contentGoals?.length
    ? input.contentGoals
    : input.contentGoal
      ? [input.contentGoal]
      : [];

  const goalsPrompt = getGoalsInstruction(goals);
  const contextPrompt = buildBusinessContextPrompt(input.businessContext);
  const strategyPrompt = input.strategy
      ? `
    CONTENT STRATEGY:

    You must use the following content pillars:

    ${JSON.stringify(input.strategy.pillars?.mainPillars || [], null, 2)}

    IMPORTANT:

    - You have 4 content pillars
    - You MUST generate EXACTLY 4 weeks (if period = month)

    PILLAR DISTRIBUTION RULE:

    - Each week MUST be assigned ONE primary pillar
    - Across the 4 weeks, you MUST use ALL 4 pillars exactly once
    - Do NOT stop after generating one week
    - Continue until all 4 weeks are created

    Example:

    Week 1 → Pillar A  
    Week 2 → Pillar B  
    Week 3 → Pillar C  
    Week 4 → Pillar D  
        `
      : "";

  const planConfigPrompt = input.planConfig
      ? `
    CONTENT PLAN CONFIGURATION:

    - Period: ${input.planConfig.period}

    You MUST generate:
    
    - Static posts per week: ${input.planConfig.staticPerWeek}
    - Dynamic posts per week: ${input.planConfig.dynamicPerWeek}
    - Stories per week: ${input.planConfig.storiesPerWeek}

    IMPORTANT:
    - You MUST strictly follow these numbers
    - Do NOT generate more or fewer items
    `
  : "";

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
  const cleaned = content
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();

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

  // Gambiarra para voltar apenas uma semana (quando o modelo insiste em gerar 4, mesmo com instrução clara de gerar 1)
  if(input.planConfig?.period === "week") {
    parsed.data.data.weeks ? parsed.data.data.weeks = [parsed.data.data.weeks[0]] : null;
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