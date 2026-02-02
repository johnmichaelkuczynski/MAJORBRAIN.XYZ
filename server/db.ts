import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@shared/schema";

// Use the external database URL provided by the user
const connectionString = process.env.EXTERNAL_DATABASE_URL;

if (!connectionString) {
  throw new Error("EXTERNAL_DATABASE_URL environment variable is required");
}

const client = postgres(connectionString, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

export const db = drizzle(client, { schema });
