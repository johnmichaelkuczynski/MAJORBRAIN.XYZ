import * as fs from "fs";
import * as path from "path";
import { db } from "./db";
import { THINKERS } from "@shared/schema";
import { sql } from "drizzle-orm";

function normalizeAuthorName(author: string): string {
  const lowerAuthor = author.toLowerCase();
  const thinker = THINKERS.find(t => 
    t.id.toLowerCase() === lowerAuthor || 
    t.name.toLowerCase() === lowerAuthor
  );
  return thinker?.name || author;
}

const INGEST_DIR = path.join(process.cwd(), "ingest");

interface IngestResult {
  file: string;
  type: string;
  author: string;
  recordsInserted: number;
  success: boolean;
  error?: string;
}

function parseFileName(fileName: string): { author: string; type: string; number: string } | null {
  const baseName = path.basename(fileName, path.extname(fileName));
  const parts = baseName.split("_");
  
  if (parts.length < 3) return null;
  
  const author = parts[0];
  const type = parts[1].toUpperCase();
  const number = parts[2];
  
  if (!["QUOTES", "WORKS", "POSITIONS", "ARGUMENTS"].includes(type)) {
    return null;
  }
  
  return { author, type, number };
}

async function ensureTablesExist(): Promise<boolean> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS positions (
        id SERIAL PRIMARY KEY,
        thinker TEXT NOT NULL,
        position_text TEXT NOT NULL,
        topic TEXT,
        source_text_id INTEGER
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS quotes (
        id SERIAL PRIMARY KEY,
        thinker TEXT NOT NULL,
        quote_text TEXT NOT NULL,
        topic TEXT,
        source_text_id INTEGER
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS arguments (
        id SERIAL PRIMARY KEY,
        thinker TEXT NOT NULL,
        argument_text TEXT NOT NULL,
        topic TEXT,
        source_text_id INTEGER
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS works (
        id SERIAL PRIMARY KEY,
        thinker TEXT NOT NULL,
        work_text TEXT NOT NULL,
        title TEXT,
        source_document TEXT
      )
    `);
    return true;
  } catch (error) {
    console.error("Failed to ensure tables exist:", error);
    return false;
  }
}

async function ingestFile(filePath: string): Promise<IngestResult> {
  const fileName = path.basename(filePath);
  const parsed = parseFileName(fileName);
  
  if (!parsed) {
    return {
      file: fileName,
      type: "UNKNOWN",
      author: "UNKNOWN",
      recordsInserted: 0,
      success: false,
      error: "Invalid file name format. Expected: AUTHOR_TYPE_N.txt"
    };
  }
  
  const { author: rawAuthor, type } = parsed;
  const author = normalizeAuthorName(rawAuthor);
  
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n").filter(line => line.trim().length > 0);
    
    let recordsInserted = 0;
    const BATCH_SIZE = 500;
    
    for (let i = 0; i < lines.length; i += BATCH_SIZE) {
      const batch = lines.slice(i, i + BATCH_SIZE);
      const values: string[] = [];
      
      for (const line of batch) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;
        
        // Escape single quotes for SQL
        const escaped = trimmedLine.replace(/'/g, "''");
        
        if (type === "QUOTES") {
          values.push(`('${author.replace(/'/g, "''")}', '${escaped}')`);
        } else if (type === "POSITIONS") {
          values.push(`('${author.replace(/'/g, "''")}', '${escaped}')`);
        } else if (type === "ARGUMENTS") {
          values.push(`('${author.replace(/'/g, "''")}', '${escaped}')`);
        } else if (type === "WORKS") {
          values.push(`('${author.replace(/'/g, "''")}', '${escaped}', '${fileName.replace(/'/g, "''")}')`);
        }
      }
      
      if (values.length === 0) continue;
      
      try {
        if (type === "QUOTES") {
          await db.execute(sql.raw(`INSERT INTO quotes (thinker, quote_text) VALUES ${values.join(",")}`));
        } else if (type === "POSITIONS") {
          await db.execute(sql.raw(`INSERT INTO positions (thinker, position_text) VALUES ${values.join(",")}`));
        } else if (type === "ARGUMENTS") {
          await db.execute(sql.raw(`INSERT INTO arguments (thinker, argument_text) VALUES ${values.join(",")}`));
        } else if (type === "WORKS") {
          await db.execute(sql.raw(`INSERT INTO works (thinker, work_text, source_document) VALUES ${values.join(",")}`));
        }
        recordsInserted += values.length;
      } catch (insertError: any) {
        console.error(`Batch insert error for ${fileName}:`, insertError.message);
      }
    }
    
    // Delete the file after processing
    fs.unlinkSync(filePath);
    
    return {
      file: fileName,
      type,
      author,
      recordsInserted,
      success: true
    };
  } catch (error: any) {
    return {
      file: fileName,
      type,
      author,
      recordsInserted: 0,
      success: false,
      error: error.message
    };
  }
}

let isProcessing = false;

export async function processIngestFolder(): Promise<IngestResult[]> {
  if (isProcessing) {
    console.log("Ingest already in progress, skipping...");
    return [];
  }
  isProcessing = true;
  
  const results: IngestResult[] = [];
  
  try {
    if (!fs.existsSync(INGEST_DIR)) {
      fs.mkdirSync(INGEST_DIR, { recursive: true });
      isProcessing = false;
      return results;
    }
    
    const tablesOk = await ensureTablesExist();
    if (!tablesOk) {
      console.error("Failed to ensure tables exist");
      isProcessing = false;
      return results;
    }
    
    const files = fs.readdirSync(INGEST_DIR).filter(f => {
      const fullPath = path.join(INGEST_DIR, f);
      try {
        return fs.statSync(fullPath).isFile() && !f.startsWith(".") && f.endsWith(".txt");
      } catch {
        return false;
      }
    });
    
    console.log(`Found ${files.length} files to process`);
    
    for (const file of files) {
      try {
        const filePath = path.join(INGEST_DIR, file);
        if (!fs.existsSync(filePath)) continue;
        
        const result = await ingestFile(filePath);
        results.push(result);
        if (result.success) {
          console.log(`Ingested ${file}: ${result.recordsInserted} records for ${result.author}`);
        } else {
          console.log(`Failed ${file}: ${result.error}`);
        }
      } catch (fileError: any) {
        console.error(`Error processing ${file}:`, fileError.message);
      }
    }
  } catch (error: any) {
    console.error("processIngestFolder error:", error.message);
  } finally {
    isProcessing = false;
  }
  
  return results;
}

export function startIngestWatcher(intervalMs: number = 10000): NodeJS.Timeout {
  console.log(`Starting ingest watcher. Monitoring: ${INGEST_DIR}`);
  console.log(`File format: AUTHOR_TYPE_N.txt (e.g., Kuczynski_QUOTES_1.txt)`);
  console.log(`Types: QUOTES, POSITIONS, ARGUMENTS, WORKS`);
  
  if (!fs.existsSync(INGEST_DIR)) {
    fs.mkdirSync(INGEST_DIR, { recursive: true });
  }
  
  // Initial process
  processIngestFolder().catch(console.error);
  
  return setInterval(async () => {
    try {
      await processIngestFolder();
    } catch (error) {
      console.error("Ingest watcher error:", error);
    }
  }, intervalMs);
}
