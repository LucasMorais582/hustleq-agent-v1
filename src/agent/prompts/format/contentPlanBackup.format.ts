export const CONTENT_PLAN_BACKUP_FORMAT = `
OUTPUT FORMAT

Return ONLY valid JSON.

IMPORTANT

You MUST follow the global response structure.

You are NOT allowed to return raw JSON directly.

You MUST wrap the backup content inside the required response format.

Required structure:

{
  "text": "Short explanation about the generated backup content.",
  "data": {
    "type": "CONTENT_PLAN_BACKUP",
    "data": {
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
  }
}
`;