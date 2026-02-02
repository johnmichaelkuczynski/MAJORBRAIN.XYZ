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

// Initialize coherence tables on startup
async function initCoherenceTables() {
  try {
    await client`
      CREATE TABLE IF NOT EXISTS coherence_sessions (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::varchar,
        session_type VARCHAR(50) NOT NULL,
        thinker_id VARCHAR(100),
        user_prompt TEXT NOT NULL,
        global_skeleton JSONB,
        target_words INTEGER NOT NULL,
        actual_words INTEGER DEFAULT 0,
        total_chunks INTEGER DEFAULT 0,
        current_chunk INTEGER DEFAULT 0,
        status VARCHAR(20) DEFAULT 'pending',
        final_output TEXT,
        error_message TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `;
    await client`
      CREATE TABLE IF NOT EXISTS coherence_chunks (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::varchar,
        session_id VARCHAR NOT NULL,
        chunk_index INTEGER NOT NULL,
        chunk_output TEXT,
        chunk_delta JSONB,
        word_count INTEGER DEFAULT 0,
        status VARCHAR(20) DEFAULT 'pending',
        processed_at TIMESTAMP
      )
    `;
    await client`
      CREATE TABLE IF NOT EXISTS stitch_results (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::varchar,
        session_id VARCHAR NOT NULL,
        conflicts JSONB,
        repairs JSONB,
        coherence_score VARCHAR(20),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;
    console.log("Coherence tables initialized");
  } catch (error) {
    console.error("Failed to initialize coherence tables:", error);
  }
}

initCoherenceTables();
