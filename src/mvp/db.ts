import { Prisma, PrismaClient } from "../generated/mvp/index.js";

// One client for the MVP schema. Tests point MVP_DATABASE_URL at the mvp_test schema.
export const db = new PrismaClient();
export type Db = typeof db;

// Raw SQL must name the schema: on the transaction pooler (port 6543) the connection's
// search_path is not ours, so an unqualified "OnboardingState" can point at another schema.
function schemaName() {
  let name = "mvp";
  try {
    name = new URL(process.env.MVP_DATABASE_URL ?? "").searchParams.get("schema") ?? "mvp";
  } catch { /* keep the default */ }
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) throw new Error(`Invalid schema name in MVP_DATABASE_URL: ${name}`);
  return name;
}
export const table = (name: string) => Prisma.raw(`"${schemaName()}"."${name.replace(/"/g, "")}"`);
