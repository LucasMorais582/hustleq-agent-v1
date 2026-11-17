export function buildBackupBlueprintPrompt(
  planConfig: any
) {
  return `
You are a senior social media strategist.

Your task is to generate BACKUP content ideas.

These posts will be used as reserve content.

They must complement the monthly strategy.

IMPORTANT

Do NOT repeat ideas already used.

Do NOT repeat hooks.

Do NOT repeat storytelling.

Do NOT repeat CTAs.

Prefer unexplored pillars.

Generate:

- ${planConfig.staticPerWeek} static ideas
- ${planConfig.dynamicPerWeek} dynamic ideas
- ${planConfig.storiesPerWeek} stories

Generate only concepts.

Do not generate captions.

Do not generate creative direction.

Do not generate production guidance.
`;
}