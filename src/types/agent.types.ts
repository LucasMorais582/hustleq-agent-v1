export type Message = {
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
  businessContext: BusinessContext;
  mode?: "IDEAS" | "ANALYSIS" | "CAPTION";
  history?: Message[];
};