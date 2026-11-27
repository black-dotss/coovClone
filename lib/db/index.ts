import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";
import { getEnv } from "@/lib/env";

export * from "./schema";

let cachedDb: NeonHttpDatabase<typeof schema> | null = null;
let cachedSql: NeonQueryFunction<false, false> | null = null;

export function getSqlClient(): NeonQueryFunction<false, false> {
  if (!cachedSql) {
    const dbUrl =
      process.env.DATABASE_URL ||
      process.env.POSTGRES_URL ||
      (function () {
        try {
          return getEnv().DATABASE_URL;
        } catch {
          return undefined;
        }
      })();

    if (!dbUrl || dbUrl.includes("build_placeholder")) {
      throw new Error("DATABASE_URL or POSTGRES_URL is not configured in environment");
    }
    cachedSql = neon(dbUrl);
  }
  return cachedSql;
}

export function getDb(): NeonHttpDatabase<typeof schema> {
  if (!cachedDb) {
    const sql = getSqlClient();
    cachedDb = drizzle(sql, { schema });
  }
  return cachedDb;
}

// Convenient export proxy that lazily instantiates the db client
export const db = new Proxy({} as NeonHttpDatabase<typeof schema>, {
  get(_target, prop: string | symbol) {
    const client = getDb();
    const value = Reflect.get(client, prop);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
