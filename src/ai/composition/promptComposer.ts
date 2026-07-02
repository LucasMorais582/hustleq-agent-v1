import type { PromptComposerInput } from "../../types/agent.types.js";

export function promptComposer({
  sections,
}: PromptComposerInput) {
  return `
    ${sections
      .filter(Boolean)
      .join("\n\n")}

    STRICT FINAL INSTRUCTION:

    - Return ONLY valid JSON
    - Do NOT include explanations
    - Do NOT include text before or after JSON
  `;
}