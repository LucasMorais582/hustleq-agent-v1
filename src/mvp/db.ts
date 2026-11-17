import { Prisma, PrismaClient } from "../generated/mvp/index.js";

// One client for the MVP schema. Tests point MVP_DATABASE_URL at the mvp_test schema.
// Interactive transactions get more than Prisma's 5 s default: a turn or a week save runs several
// statements, and through the transaction pooler each round trip can take a while.
export const db = new PrismaClient({ transactionOptions: { maxWait: 15_000, timeout: 30_000 } });
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
