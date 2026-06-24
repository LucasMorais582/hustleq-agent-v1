export const CONTENT_PLAN_FORMAT = `
OUTPUT FORMAT

Return ONLY valid JSON.

IMPORTANT

Respect EXACTLY the quantities defined in configuration
Do NOT generate fewer items
Do NOT generate more items
All arrays must match the requested quantity exactly

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

],

"backupContent": {
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
`;


// export const CONTENT_PLAN_FORMAT = `
//   OUTPUT FORMAT:

//   Return ONLY JSON.

//   IMPORTANT:

//   The arrays MUST contain EXACTLY the number of items defined in the configuration.
//   The example below shows structure only, NOT quantity.
//   Every field must contain highly detailed, specific, and execution-ready information.
//   Avoid short or generic descriptions.
//   Each response must provide enough information so a marketing team can immediately create the content without additional planning.

//   {
//   "weeks": [
//   {
//   "week": 1,
//   "pillar": "string",

//     "staticPosts": [
//       { "idea": { "title": "string", "description": "Detailed explanation of the content objective and message", "hook": "Attention-grabbing opening statement", "goal": "Specific marketing objective", "funnelStage": "TOFU | MOFU | BOFU" }, "caption": { "hook": "Opening sentence", "body": "Main caption body with persuasive messaging", "cta": "Clear next action", "caption": "Full final caption" }, "productionGuidance": { "contentFormat": "Carousel | Static Image | Reel | Video | Story Sequence", "narrativeFlow": "Describe the exact logical flow of the content from beginning to end", "productionInstructions": "Specific instructions explaining how the content should be created step by step", "creatorNotes": "Important recommendations for the designer or content creator during execution" }, "creativeDirection": { "visualStyle": "Describe overall visual style and aesthetic direction", "composition": "Describe how visual elements should be organized on screen", "visualElements": "Specific objects, icons, images, UI elements, people, or assets that should appear", "typographyGuidance": "Describe font hierarchy, text positioning, and text style recommendations", "emotionalTone": "Describe what emotional feeling the content should communicate", "executionDetails": "Detailed creative execution recommendations for production" } } ],
//         "dynamicPosts": [ { "idea": { "title": "string", "description": "Detailed explanation of the content objective and message", "hook": "Attention-grabbing opening statement", "goal": "Specific marketing objective", "funnelStage": "TOFU | MOFU | BOFU" }, "caption": { "hook": "Opening sentence", "body": "Main caption body with persuasive messaging", "cta": "Clear next action", "caption": "Full final caption" }, "productionGuidance": { "contentFormat": "Carousel | Static Image | Reel | Video | Story Sequence", "narrativeFlow": "Describe the exact logical flow of the content from beginning to end", "productionInstructions": "Specific instructions explaining how the content should be created step by step", "creatorNotes": "Important recommendations for the designer or content creator during execution" }, "creativeDirection": { "visualStyle": "Describe overall visual style and aesthetic direction", "composition": "Describe how visual elements should be organized on screen", "visualElements": "Specific objects, icons, images, UI elements, people, or assets that should appear", "typographyGuidance": "Describe font hierarchy, text positioning, and text style recommendations", "emotionalTone": "Describe what emotional feeling the content should communicate", "executionDetails": "Detailed creative execution recommendations for production" } } ],
//         "stories": [
//       {
//         "idea": {
//           "title": "string",
//           "description": "Detailed explanation of the story objective and message"
//         },

//         "productionGuidance": {
//           "contentFormat": "Story Sequence",
//           "narrativeFlow": "Describe sequence of story progression slide by slide",
//           "productionInstructions": "Explain how stories should be produced and ordered",
//           "creatorNotes": "Recommendations for story creation"
//         },

//         "creativeDirection": {
//           "visualStyle": "Describe visual style and design direction",
//           "composition": "Describe organization of elements on each story",
//           "visualElements": "Specific visual assets that should appear",
//           "typographyGuidance": "Text size, hierarchy, placement, readability recommendations",
//           "emotionalTone": "Describe emotional tone the stories should communicate",
//           "executionDetails": "Detailed production recommendations"
//         }
//       }
//     ]
//   }

//   ],

// "backupContent": {
//   "staticPosts": [
//     {
//       "idea": {
//         "title": "string",
//         "description": "Detailed explanation of the content objective and message",
//         "hook": "Attention-grabbing opening statement",
//         "goal": "Specific marketing objective",
//         "funnelStage": "TOFU | MOFU | BOFU"
//       },
//       "caption": {
//         "hook": "Opening sentence",
//         "body": "Main caption body with persuasive messaging",
//         "cta": "Clear next action",
//         "caption": "Full final caption"
//       },
//       "productionGuidance": {
//         "contentFormat": "string",
//         "narrativeFlow": "string",
//         "productionInstructions": "string",
//         "creatorNotes": "string"
//       },
//       "creativeDirection": {
//         "visualStyle": "string",
//         "composition": "string",
//         "visualElements": "string",
//         "typographyGuidance": "string",
//         "emotionalTone": "string",
//         "executionDetails": "string"
//       }
//     }
//     ],
//   "dynamicPosts": [
//     {
//       "idea": {},
//       "caption": {},
//       "productionGuidance": {},
//       "creativeDirection": {}
//     }
//     ],
//     "stories": [
//     {
//       "idea": {},
//       "productionGuidance": {},
//       "creativeDirection": {}
//     }
//     ]
//   }
// }
// `;