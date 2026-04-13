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

export type AgentInput = {
  userMessage: string;
  instagramData: any;
  contentGoal?: "ENGAGEMENT" | "CONVERSION" | "EDUCATIONAL" | "BRAND" | "STORYTELLING";
  businessContext: BusinessContext;
  mode?: "IDEAS" | "ANALYSIS" | "CAPTION";
  history?: HistoryMessage[];
};