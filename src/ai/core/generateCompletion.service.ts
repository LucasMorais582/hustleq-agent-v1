import type { ChatCompletionMessageParam } from "openai/resources";
import { callOpenAI } from "./callOpenAI.js";

type GenerateCompletionInput = {
  messages: ChatCompletionMessageParam[];
  temperature?: number;
  model?: string;
};

export async function generateCompletion({
  messages,
  temperature = 0.7,
  model = "gpt-4o",
}: GenerateCompletionInput) {
  return callOpenAI({
    messages,
    temperature,
    model,
  });
}