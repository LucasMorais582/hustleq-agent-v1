
export function buildWeekBlueprintPromptFormat(week: any) {

return `
Return ONLY valid JSON.

{
  "text": "Short strategic explanation",

  "data": {
    "type": "CONTENT_WEEK_BLUEPRINT",

    "data": {
      "week": ${week},

      "blueprint": [
        {
          "slot": 1,

          "contentType": "static",

          "format": "Carousel",

          "pillar": "string",

          "goal": "string",

          "concept": "string"
        }
      ]
    }
  }
}
`;

}