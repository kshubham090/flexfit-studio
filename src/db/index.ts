import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as {
  client: ReturnType<typeof createClient> | undefined;
};

const client =
  globalForDb.client ?? createClient({ url: process.env.DB_FILE ?? "file:flexfit.db" });

if (process.env.NODE_ENV !== "production") {
  globalForDb.client = client;
}

export const db = drizzle(client, { schema });
export { schema };
