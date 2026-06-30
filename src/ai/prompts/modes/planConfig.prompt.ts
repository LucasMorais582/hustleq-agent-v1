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

    CRITICAL VALIDATION RULE

    These quantities are mandatory.

    You MUST generate EXACTLY these numbers.

    Examples:

    If static posts per week = 3

    The staticPosts array MUST contain exactly 3 complete objects.

    If dynamic posts per week = 2

    The dynamicPosts array MUST contain exactly 2 complete objects.

    If stories per week = 4

    The stories array MUST contain exactly 4 complete objects.

    Returning fewer items is INVALID.

    Returning more items is INVALID.

    You must count every array before returning.
  `
  : "";

    return planConfigPrompt;
}