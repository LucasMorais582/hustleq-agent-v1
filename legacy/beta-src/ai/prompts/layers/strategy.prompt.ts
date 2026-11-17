export function getStrategyPrompt(input?: any) {
  if (!input?.strategy) return "";

  return `
  CONTENT STRATEGY:

  Use the following strategic pillars as inspiration:

  ${JSON.stringify(
    input.strategy.pillars?.mainPillars || [],
    null,
    2
  )}

  IMPORTANT:

  This content plan is NOT organized by assigning one pillar per week.

  Different weeks should combine multiple strategic pillars.

  Content variety is extremely important.

  Different posts inside the same week should explore different business angles.

  You should use the strategy as creative guidance, NOT as a rigid weekly structure.

  PRIORITIES:

  - Avoid repetitive topics
  - Mix awareness, engagement, authority, and conversion angles
  - Use different pillars naturally across content generation
  `;
}