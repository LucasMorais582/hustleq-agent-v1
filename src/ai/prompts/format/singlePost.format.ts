export const CONTENT_SINGLE_POST_FORMAT = `
Return ONLY valid JSON.

{
  "text": "Short strategic explanation",

  "data": {
    "type": "CONTENT_SINGLE_POST",

    "data": {
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
      },

      "postingReminder": [
        "string"
      ]
    }
  }
}
`;