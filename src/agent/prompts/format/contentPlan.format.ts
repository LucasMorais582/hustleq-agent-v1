export const CONTENT_PLAN_FORMAT = `
OUTPUT FORMAT:

Return ONLY JSON.

IMPORTANT:
- The arrays MUST contain EXACTLY the number of items defined in the configuration.
- The example below shows structure only, NOT quantity.

{
  "weeks": [
    {
      "week": 1,
      "pillar": "string",

      "staticPosts": [
        {
          "idea": {
            "title": "string",
            "description": "string",
            "hook": "string",
            "goal": "string"
          },
          "caption": {
            "hook": "string",
            "body": "string",
            "cta": "string",
            "caption": "string"
          },
          "creativeDirection": {
            "visual": "string",
            "structure": "string",
            "execution": "string"
          }
        }
      ],

      "dynamicPosts": [
        {
          "idea": {
            "title": "string",
            "description": "string",
            "hook": "string",
            "goal": "string"
          },
          "caption": {
            "hook": "string",
            "body": "string",
            "cta": "string",
            "caption": "string"
          },
          "creativeDirection": {
            "visual": "string",
            "structure": "string",
            "execution": "string"
          }
        }
      ],

      "stories": [
        {
          "idea": {
            "title": "string",
            "description": "string"
          },
          "creativeDirection": {
            "visual": "string",
            "structure": "string",
            "execution": "string"
          }
        }
      ]
    }
  ]
}
`;