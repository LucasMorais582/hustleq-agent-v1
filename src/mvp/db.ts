import { PrismaClient } from "../generated/mvp/index.js";

// One client for the MVP schema. Tests point MVP_DATABASE_URL at the mvp_test schema.
export const db = new PrismaClient();
export type Db = typeof db;
