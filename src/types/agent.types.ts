export type Message = {
  role: "user" | "assistant";
  content: string;
};

export type HistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

export type BusinessContextInput = {
  businessName?: string;
  description?: string;
  niche?: string;
  location?: string;
  experienceLevel?: string;
  type?: string;

  offerings?: string[];

  idealCustomer?: string;
  mainProblem?: string;
  customerMindset?: string;
  acquisitionChannels?: string[];

  primaryGoals?: string[];
  successDefinition?: string;
  shortTermStrategy?: string;

  tone?: string[];
  desiredFeeling?: string;
  avoidTopics?: string[];

  contentFocus?: string[];
  currentIssues?: string[];
  desiredShift?: string;

  inspirations?: string[];
  competitors?: string[];
};

export type AgentInput = {
  userMessage: string;
  instagramData: any;
  contentGoal?: "ENGAGEMENT" | "CONVERSION" | "EDUCATIONAL" | "BRAND" | "STORYTELLING";
  businessContext: BusinessContextInput;
  mode?: "IDEAS" | "ANALYSIS" | "CAPTION" | "BEST_TIME" | "PERSONA" | "MARKET_INSIGHTS" | undefined;
  history?: HistoryMessage[];
};