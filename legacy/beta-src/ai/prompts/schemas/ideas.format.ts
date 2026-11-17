export const IDEAS_FORMAT = `
Return ONLY JSON in this format:

{
  "ideas": [
    {
      "title": "string",
      "description": "string",
      "format": "reel | post | story",
      "hook": "string",
      "goal": "string"
    }
  ]
}

DO NOT include:
- diagnostic
- strategy
- examples
- postingFrequency
- bestTime

ONLY return "ideas".
`;