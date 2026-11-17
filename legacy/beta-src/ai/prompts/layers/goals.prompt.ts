export function getGoalsInstructionPrompt(goals?: string[]) {
    if (!goals || goals.length === 0) return "";

  const goalDescriptions: Record<string, string> = {
    ENGAGEMENT: `
      - Focus on comments, shares and interaction
      - Use questions when appropriate
      - Encourage users to respond
      `,
    CONVERSION: `
      - Drive action (buy, click, message)
      - Use strong and clear CTA
      - Highlight value and urgency
      `,
    EDUCATIONAL: `
      - Teach something useful
      - Be clear and structured
      - Deliver value before asking for action
      `,
    BRAND: `
      - Strengthen brand perception
      - Highlight positioning and identity
      - Build emotional connection
      `,
    STORYTELLING: `
      - Tell relatable or emotional stories
      - Use narrative structure
      - Create connection with audience
      `
  };

  return `
    CONTENT GOALS:

    You must consider the following goals:

    ${goals.map(g => `- ${g}`).join("\n")}

    GOAL EXECUTION RULES:

    ${goals
      .map(g => `Goal: ${g}\n${goalDescriptions[g] || ""}`)
      .join("\n")}

    DISTRIBUTION RULE:

    - Each content item should prioritize ONE primary goal
    - Do NOT try to satisfy all goals in a single post
    - Across the full plan, ALL goals must be represented
    - Distribute goals across different posts

    Example:

    Post 1 → ENGAGEMENT  
    Post 2 → CONVERSION  
    Post 3 → EDUCATIONAL  
    Post 4 → BRAND  
  `;
}