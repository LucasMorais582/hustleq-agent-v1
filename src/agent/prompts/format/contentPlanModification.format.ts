export const CONTENT_PLAN_MODIFICATION_FORMAT = `
OUTPUT FORMAT

Return ONLY valid JSON.

IMPORTANT

Generate ONLY ONE week.

Respect EXACTLY the quantities defined in configuration.

{
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
    }
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
    }
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
    }
  ],

  "executionRequirements": {
    "summary": "string",
    "requirements": ["string"],
    "importantNotes": ["string"]
  }
}
`;