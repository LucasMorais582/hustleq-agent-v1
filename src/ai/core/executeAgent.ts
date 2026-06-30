import { generateCompletion } from "./generateCompletion.service.js";
import { formatAgentResponse } from "../formatting/formatAgentResponse.js";
import type { ChatCompletionMessageParam } from "openai/resources";
import { temperatureRouter } from "./temperatureRouter.js";

type ExecuteAgentInput = {
  messages: ChatCompletionMessageParam[];
  model?: string;
  mode?: string;
};

export async function executeAgent({
  messages,
  model = "gpt-4o",
  mode = "TEXT",
}: ExecuteAgentInput) {

  const temperature =
    temperatureRouter(mode);

  const parsed =
    await generateCompletion({
      messages,
      temperature,
      model,
    });

  return formatAgentResponse(
    parsed,
    mode
  );
}