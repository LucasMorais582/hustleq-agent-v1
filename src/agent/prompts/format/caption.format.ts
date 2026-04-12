export const CAPTION_FORMAT = `
Return ONLY JSON:

{
  "hook": "string",
  "body": "string",
  "cta": "string",
  "caption": "full caption combining all parts",
  "variations": ["string"]
}

RULES:
- "hook" must be the first line and grab attention
- "body" must deliver value or context
- "cta" must be clear and actionable
- "caption" must combine hook + body + cta naturally

DO NOT include any other fields.
`;