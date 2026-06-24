export function getStrategyPrompt(input?: any) {
    const strategyPrompt = input.strategy
      ? `
    CONTENT STRATEGY:

    You must use the following content pillars:

    ${JSON.stringify(input.strategy.pillars?.mainPillars || [], null, 2)}

    IMPORTANT:

    - You have 4 content pillars
    - You MUST generate EXACTLY 4 weeks (if period = month)

    PILLAR DISTRIBUTION RULE:

    - Each week MUST be assigned ONE primary pillar
    - Across the 4 weeks, you MUST use ALL 4 pillars exactly once
    - Do NOT stop after generating one week
    - Continue until all 4 weeks are created

    Example:

    Week 1 → Pillar A  
    Week 2 → Pillar B  
    Week 3 → Pillar C  
    Week 4 → Pillar D  
        `
      : "";

    return strategyPrompt;
}