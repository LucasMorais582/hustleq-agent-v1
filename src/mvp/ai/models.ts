// Which Claude model does what (decided 17/11), and what each costs per million tokens.

export const MODELS = {
  duke: "claude-sonnet-5-5", // chat, tools, week, strategy, campaign, image validation
  light: "claude-haiku-5-5", // titles, classification
  deep: "claude-opus-5-5", // only where it shows a gain (monthly analysis)
} as const;

export type ModelRole = keyof typeof MODELS;

const PRICE_PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-opus-5-5": { input: 4, output: 20 },
};

export type TokenUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};

// Cache writes cost 1.25x input, cache reads 0.1x. Batch requests cost half.
export function costUsd(model: string, usage: TokenUsage, { batch = false } = {}) {
  const price = PRICE_PER_MTOK[model];
  if (!price) return 0;
  const read = usage.cache_read_input_tokens ?? 0;
  const write = usage.cache_creation_input_tokens ?? 0;
  const dollars =
    (usage.input_tokens * price.input +
      write * price.input * 1.25 +
      read * price.input * 0.1 +
      usage.output_tokens * price.output) /
    1_000_000;
  return batch ? dollars / 2 : dollars;
}
