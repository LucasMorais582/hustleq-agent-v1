import "../../config/env.js";
import { db } from "../db.js";
import { hashPassword } from "../auth/password.js";

// Creates (or resets) the test login from MVP_SEED_EMAIL / MVP_SEED_PASSWORD in .env,
// with a Bahia Taste business profile. Test data only.
const email = process.env.MVP_SEED_EMAIL?.toLowerCase();
const password = process.env.MVP_SEED_PASSWORD;
if (!email || !password) throw new Error("Set MVP_SEED_EMAIL and MVP_SEED_PASSWORD in .env");

const passwordHash = await hashPassword(password);
const user = await db.user.upsert({
  where: { email },
  update: { passwordHash },
  create: { email, passwordHash, role: "admin", instagramHandle: "bahiataste", termsAcceptedAt: new Date(), termsVersion: "test" },
});
await db.businessProfile.upsert({
  where: { userId: user.id },
  update: {},
  create: {
    userId: user.id,
    businessName: "Bahia Taste",
    whatYouDo: "Bahian food for events and weekly meal delivery",
    niche: "Brazilian food",
    location: "New York and New Jersey",
    completedAt: new Date(),
  },
});
// The test admin skips onboarding.
await db.onboardingState.upsert({ where: { userId: user.id }, update: { status: "done", step: 4 }, create: { userId: user.id, status: "done", step: 4 } });
console.log(`Test user ready: ${email} (role ${user.role})`);
await db.$disconnect();
