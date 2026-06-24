export function getPlanConfigPrompt(input?: any) {
  const backupStaticPosts = input.planConfig? Math.max(1, Math.ceil(input.planConfig.staticPerWeek / 2)) : 2;
  const backupDynamicPosts = input.planConfig ? Math.max(1, Math.ceil(input.planConfig.dynamicPerWeek / 2)) : 1;
  const backupStories = input.planConfig ? Math.max(1, Math.ceil(input.planConfig.storiesPerWeek / 2)) : 3;
  
  const planConfigPrompt = input.planConfig
      ? `
    CONTENT PLAN CONFIGURATION:

    - Period: ${input.planConfig.period}

    You MUST generate:
    
    - Static posts per week: ${input.planConfig.staticPerWeek}
    - Dynamic posts per week: ${input.planConfig.dynamicPerWeek}
    - Stories per week: ${input.planConfig.storiesPerWeek}

    You MUST generate in the content backup section (if period = month):

    - Backup static posts: ${backupStaticPosts}
    - Backup dynamic posts: ${backupDynamicPosts}
    - Backup stories: ${backupStories}

    IMPORTANT:
    - You MUST strictly follow these numbers
    - Do NOT generate more or fewer items
    `
  : "";

    return planConfigPrompt;
}