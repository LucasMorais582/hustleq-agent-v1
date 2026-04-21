export type Message = {
  role: "user" | "assistant";
  content: string;
};

export type HistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

export type BusinessContext = {
  niche: string;
  targetAudience?: string;
  goal?: string;
  tone?: string;
};

// Evolução do tipo
// export type BusinessContext = {
//   businessName?: string;
//   website?: string;

//   niche: string;
//   targetAudience: string;
//   offer: string;
//   priceRange?: string;

//   differentiator?: string;

//   tone?: string;

//   contentGoals?: string;
//   contentPreferences?: string[];

//   contentPillars?: string[];

//   competitors?: string[];

//   brainDump?: string;

//   constraints?: string[];
// };

export type AgentInput = {
  userMessage: string;
  instagramData: any;
  contentGoal?: "ENGAGEMENT" | "CONVERSION" | "EDUCATIONAL" | "BRAND" | "STORYTELLING";
  businessContext: BusinessContext;
  mode?: "IDEAS" | "ANALYSIS" | "CAPTION" | "BEST_TIME" | "PERSONA" | "MARKET_INSIGHTS" | undefined;
  history?: HistoryMessage[];
};