import { execSync } from "node:child_process";
import dotenv from "dotenv";

export default function setup() {
  dotenv.config({ path: "./.env", quiet: true });
  const url = process.env.MVP_TEST_DATABASE_URL;
  if (!url || !/[?&]schema=mvp_test(&|$)/.test(url)) throw new Error("MVP_TEST_DATABASE_URL must point at schema=mvp_test");
  execSync("npx prisma migrate deploy --schema prisma/mvp/schema.prisma", {
    env: { ...process.env, MVP_DATABASE_URL: url, MVP_DIRECT_URL: process.env.MVP_TEST_DIRECT_URL },
    stdio: "ignore",
  });
}
