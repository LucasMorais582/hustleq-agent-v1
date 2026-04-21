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
- ALL text MUST be in English
- "hook" must be the first line and grab attention
- "body" must deliver value or context
- "cta" must be clear and actionable
- "caption" must combine hook + body + cta naturally

VARIATION RULES:
- Must return exactly 3 variations
- Each variation must be a full caption (hook + body + CTA)
- Each variation must use a different angle or approach
- Variations must NOT be simple rewrites of the main caption

DO NOT include any other fields.
`;