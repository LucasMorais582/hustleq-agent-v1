import OpenAI from "openai";

import type { ChatCompletionMessageParam } from "openai/resources";
import { parseOpenAIResponse } from "./parseOpenAIResponse.js";

type OpenAIInput = {
  messages: ChatCompletionMessageParam[];
  temperature?: number;
  model?: string;
};

export async function callOpenAI({
  messages,
  temperature = 0.7,
  model = "gpt-4o",
}: OpenAIInput) {
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const response =
    await openai.chat.completions.create({
      model,
      messages,
      temperature,
    });

  const content =
    response.choices[0]?.message?.content ?? "";

  return parseOpenAIResponse(content);
}