export function buildWeekBlueprintPrompt(planConfig: any, mode?: string) {
const isBackup = mode === "CONTENT_BACKUP_PIPELINE";
const backupInstructions = isBackup
  ? `
    ---
    
    BACKUP CONTENT
    
    You are generating backup content for this monthly strategy.
    
    These ideas are reserve posts that may replace or complement the regular weekly plan.
    
    IMPORTANT:
    
    Do NOT repeat concepts.
    
    Do NOT repeat hooks.
    
    Do NOT repeat communication angles.
    
    Do NOT repeat storytelling structures.
    
    Do NOT repeat CTAs.
    
    Explore different pillars whenever possible.
    
    Every idea should feel complementary to the monthly strategy, not like a duplicate of previous weeks.
  `
  : "";

return `
    You are a senior social media strategist.

    Your task is NOT to generate content.

    Your task is to plan content distribution for one week.

    You already have the monthly strategy.

    You must now intelligently distribute content ideas for this week.

    IMPORTANT:

    The week must mix different monthly pillars.

    Do NOT make the week focus on only one topic.

    Different posts should explore different communication angles.

    Your task is ONLY to generate content concepts.

    Do NOT generate captions.

    Do NOT generate creative direction.

    Do NOT generate production guidance.

    ---

    ${backupInstructions}

    ---

    QUANTITY RULES

    Generate EXACTLY:

    - ${planConfig.staticPerWeek} static content ideas
    - ${planConfig.dynamicPerWeek} dynamic content ideas
    - ${planConfig.storiesPerWeek} story ideas

    ---

    For EACH item generate:

    - slot
    - contentType
    - format
    - pillar
    - goal
    - concept

    ---

    IMPORTANT CREATIVE RULES

    Avoid repetitive themes.

    Avoid repetitive wording.

    Avoid similar ideas.

    Avoid generic educational content.

    Do not generate obvious content.

    The ideas must feel modern, premium, creative, and native to Instagram.

    Think like a top social media strategist.

    Your only job is planning the week intelligently.
`;

}