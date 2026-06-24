export const CONTENT_PLAN_WEEK_FORMAT = `
OUTPUT FORMAT

Return ONLY valid JSON.

IMPORTANT

You MUST return the response using EXACTLY this structure.

Do NOT return the week object directly.

You MUST wrap everything inside the standard response format.

The response MUST follow EXACTLY this structure:

{
  "text": "Short explanation about the generated week",

  "data": {
    "type": "CONTENT_PLAN_WEEK",

    "data": {
      "week": 1,
      "pillar": "string",

      "staticPosts": [
        {
          "idea": {
            "title": "string",
            "description": "string",
            "hook": "string",
            "goal": "string",
            "funnelStage": "TOFU | MOFU | BOFU"
          },

          "caption": {
            "hook": "string",
            "body": "string",
            "cta": "string",
            "caption": "string"
          },

          "productionGuidance": {
            "contentFormat": "string",
            "narrativeFlow": "string",
            "productionInstructions": "string",
            "creatorNotes": "string"
          },

          "creativeDirection": {
            "visualStyle": "string",
            "composition": "string",
            "visualElements": "string",
            "typographyGuidance": "string",
            "emotionalTone": "string",
            "executionDetails": "string"
          }
        },
        { ... additional items until required quantity is reached }
      ],

      "dynamicPosts": [
        {
          "idea": {
            "title": "string",
            "description": "string",
            "hook": "string",
            "goal": "string",
            "funnelStage": "TOFU | MOFU | BOFU"
          },

          "caption": {
            "hook": "string",
            "body": "string",
            "cta": "string",
            "caption": "string"
          },

          "productionGuidance": {
            "contentFormat": "string",
            "narrativeFlow": "string",
            "productionInstructions": "string",
            "creatorNotes": "string"
          },

          "creativeDirection": {
            "visualStyle": "string",
            "composition": "string",
            "visualElements": "string",
            "typographyGuidance": "string",
            "emotionalTone": "string",
            "executionDetails": "string"
          }
        },
        { ... additional items until required quantity is reached }
      ],

      "stories": [
        {
          "idea": {
            "title": "string",
            "description": "string"
          },

          "productionGuidance": {
            "contentFormat": "string",
            "narrativeFlow": "string",
            "productionInstructions": "string",
            "creatorNotes": "string"
          },

          "creativeDirection": {
            "visualStyle": "string",
            "composition": "string",
            "visualElements": "string",
            "typographyGuidance": "string",
            "emotionalTone": "string",
            "executionDetails": "string"
          }
        },
        { ... additional items until required quantity is reached }
      ],

      "executionRequirements": {
        "summary": "string",
        "requirements": ["string"],
        "importantNotes": ["string"]
      }
    }
  }
}

CRITICAL RULES

- Do NOT return raw week object
- Do NOT omit "text"
- Do NOT omit "data.type"
- data.type MUST be EXACTLY "CONTENT_PLAN_WEEK"
- Respect EXACTLY the requested quantities
`;