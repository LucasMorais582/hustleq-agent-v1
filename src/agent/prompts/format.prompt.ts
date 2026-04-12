export const FORMAT_PROMPT = `
You must respond ONLY in valid JSON.

{
  "diagnostic": "string",
  "strategy": "string",
  "ideas": ["string"],
  "examples": "string",
  "postingFrequency": "string",
  "bestTime": "string"
}

No markdown. No extra text.
`;