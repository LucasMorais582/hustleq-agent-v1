import { apiSource } from "./api.js";
import { demoSource } from "./demo.js";
import { fakeSource } from "./fake.js";
import type { SocialDataSource } from "./types.js";

export * from "./types.js";

// SOCIAL_DATA_MODE: fake (default) | demo (the Meet Duke endpoint) | api (Helio's MVP endpoints).
export const socialDataMode = () => (process.env.SOCIAL_DATA_MODE === "api" ? "api" : process.env.SOCIAL_DATA_MODE === "demo" ? "demo" : "fake");
export const isApiMode = () => socialDataMode() === "api";

// `asUserId`: who is asking (the API logs the lookup's cost against them).
export function socialData(asUserId = "hustleq-system"): SocialDataSource {
  switch (socialDataMode()) {
    case "api":
      return apiSource(asUserId);
    case "demo":
      return demoSource;
    default:
      return fakeSource;
  }
}
