import { demoSource } from "./demo.js";
import { fakeSource } from "./fake.js";
import type { SocialDataSource } from "./types.js";

export * from "./types.js";

// SOCIAL_DATA_MODE: fake (default) | demo. "api" comes when Helio's endpoints exist.
export function socialData(): SocialDataSource {
  switch (process.env.SOCIAL_DATA_MODE) {
    case "demo":
      return demoSource;
    default:
      return fakeSource;
  }
}
