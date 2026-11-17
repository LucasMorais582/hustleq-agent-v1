import dotenv from "dotenv";

// Tests never touch the real "mvp" schema: they run on "mvp_test", migrated before each run (nothing is deleted; every test makes its own users).
dotenv.config({ path: "./.env", quiet: true });
if (!process.env.MVP_TEST_DATABASE_URL) throw new Error("Set MVP_TEST_DATABASE_URL in .env");
process.env.MVP_DATABASE_URL = process.env.MVP_TEST_DATABASE_URL;
process.env.MVP_DIRECT_URL = process.env.MVP_TEST_DIRECT_URL;
process.env.MVP_JOBS_SCHEMA = "mvp_test_jobs";
process.env.SOCIAL_DATA_MODE = "fake";
process.env.APP_ORIGINS = "http://localhost:5173";
process.env.INVITE_TOKEN_SECRET ||= "test-invite-secret";
process.env.APP_URL = "http://localhost:5173";
delete process.env.RESEND_API_KEY; // tests never send real email
