export const ANALYSIS_FORMAT = `
Return ONLY valid JSON.

Do NOT use markdown.
Do NOT wrap with \`\`\`.
Do NOT include any text before or after the JSON.

{
  "diagnostic": "string",
  "strengths": ["string"],
  "weaknesses": ["string"],
  "strategy": "string",
  "quickWins": ["string"]
}
`;