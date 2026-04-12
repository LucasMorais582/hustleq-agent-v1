export type Message = {
  role: "user" | "assistant";
  content: string;
};

export type AgentInput = {
  userMessage: string;
  instagramData: any;
  businessContext?: {
    niche: string;
    targetAudience?: string;
  };
  history?: Message[];
};