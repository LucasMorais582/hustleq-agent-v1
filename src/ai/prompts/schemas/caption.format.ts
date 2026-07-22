export const CAPTION_FORMAT = `
Return ONLY JSON.

IMPORTANT:

You must detect if the request is:
- Single caption
- Multiple captions (based on multiple ideas)

---------------------
SINGLE CAPTION FORMAT:
---------------------

{
  "hook": "string",
  "body": "string",
  "cta": "string",
  "caption": "full caption combining all parts",
  "variations": ["string"]
}

---------------------
MULTIPLE CAPTIONS FORMAT:
---------------------

{
  "captions": [
    {
      "title": "idea title",
      "hook": "string",
      "body": "string",
      "cta": "string",
      "caption": "full caption combining all parts"
    }
  ]
}

---------------------
RULES:
---------------------

- ALL text MUST be in English
- Hook must grab attention immediately
- Body must deliver value or context
- CTA must be clear and actionable

MULTIPLE CAPTIONS RULES:

- If LAST_OUTPUT contains multiple ideas:
  - You MUST generate one caption per idea
  - Each caption MUST match the corresponding idea
  - Use the idea's title as reference

SINGLE CAPTION RULES:

- Generate 1 main caption
- Generate exactly 3 variations
- Variations must be full captions with different angles

CRITICAL:

- Do NOT mix formats
- Do NOT return single caption when multiple are required
- Do NOT return variations in multiple captions mode
- Do NOT add extra fields
`;