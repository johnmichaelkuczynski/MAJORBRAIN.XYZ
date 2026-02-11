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

interface ParsedFileName {
  author: string;
  type: string;
  number: string;
  isCore: boolean;
}

function parseFileName(fileName: string): ParsedFileName | null {
  const baseName = path.basename(fileName, path.extname(fileName));
  const parts = baseName.split("_");
  
  // Check for CORE_ prefix: CORE_AUTHOR_N.txt
  if (parts[0].toUpperCase() === "CORE" && parts.length >= 3) {
    return {
      author: parts[1],
      type: "CORE",
      number: parts[2],
      isCore: true
    };
  }
  
  // Standard format: AUTHOR_TYPE_N.txt
  if (parts.length < 3) return null;
  
  const author = parts[0];
  const type = parts[1].toUpperCase();
  const number = parts[2];
  
  if (!["QUOTES", "WORKS", "POSITIONS", "ARGUMENTS", "OUTLINES"].includes(type)) {
    return null;
  }
  
  return { author, type, number, isCore: false };
}

interface CoreRecord {
  type: string;
  content: string;
}

function parseCoreDocument(content: string, author: string, fileName: string): CoreRecord[] {
  const records: CoreRecord[] = [];
  
  // Parse sections from CORE document
  const sections = [
    { header: "=== DETAILED OUTLINE ===", type: "outline" },
    { header: "=== KEY POSITIONS ===", type: "position" },
    { header: "=== KEY ARGUMENTS ===", type: "argument" },
    { header: "=== TRENDS OF THOUGHT ===", type: "trend" },
    { header: "=== QUESTIONS AND ANSWERS ===", type: "qa" }
  ];
  
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const nextSection = sections[i + 1];
    
    const startIdx = content.indexOf(section.header);
    if (startIdx === -1) continue;
    
    let endIdx = content.length;
    if (nextSection) {
      const nextIdx = content.indexOf(nextSection.header);
      if (nextIdx > startIdx) endIdx = nextIdx;
    }
    
    const sectionContent = content.substring(startIdx + section.header.length, endIdx).trim();
    
    if (section.type === "outline") {
      // Store entire outline as one record
      if (sectionContent) {
        records.push({ type: "outline", content: sectionContent });
      }
    } else if (section.type === "position") {
      // Parse each POSITION: line
      const lines = sectionContent.split("\n");
      for (const line of lines) {
        const match = line.match(/^POSITION:\s*(.+)$/i);
        if (match && match[1].trim()) {
          records.push({ type: "position", content: match[1].trim() });
        }
      }
    } else if (section.type === "argument") {
      // Parse each ARGUMENT: line  
      const lines = sectionContent.split("\n");
      for (const line of lines) {
        const match = line.match(/^ARGUMENT:\s*(.+)$/i);
        if (match && match[1].trim()) {
          records.push({ type: "argument", content: match[1].trim() });
        }
      }
    } else if (section.type === "trend") {
      // Parse each TREND: line
      const lines = sectionContent.split("\n");
      for (const line of lines) {
        const match = line.match(/^TREND:\s*(.+)$/i);
        if (match && match[1].trim()) {
          records.push({ type: "trend", content: match[1].trim() });
        }
      }
    } else if (section.type === "qa") {
      // Parse Q/A pairs line by line
      const lines = sectionContent.split("\n");
      let currentQ = "";
      let currentA = "";
      
      for (const line of lines) {
        const qMatch = line.match(/^Q\d+:\s*(.+)$/);
        const aMatch = line.match(/^A\d+:\s*(.+)$/);
        
        if (qMatch) {
          // If we had a complete Q/A pair, save it
          if (currentQ && currentA) {
            records.push({ type: "qa", content: `Q: ${currentQ}\nA: ${currentA}` });
          }
          currentQ = qMatch[1].trim();
          currentA = "";
        } else if (aMatch) {
          currentA = aMatch[1].trim();
        } else if (currentA && line.trim()) {
          // Continuation of answer
          currentA += " " + line.trim();
        }
      }
      // Save last pair
      if (currentQ && currentA) {
        records.push({ type: "qa", content: `Q: ${currentQ}\nA: ${currentA}` });
      }
    }
  }
  
  console.log(`Parsed ${records.length} records from CORE document for ${author}`);
  return records;
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
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS core_content (
        id SERIAL PRIMARY KEY,
        thinker TEXT NOT NULL,
        content_type TEXT NOT NULL,
        content TEXT NOT NULL,
        source_document TEXT,
        priority INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS outlines (
        id SERIAL PRIMARY KEY,
        thinker TEXT NOT NULL,
        outline_text TEXT NOT NULL,
        title TEXT,
        topic TEXT,
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
  
  const { author: rawAuthor, type, isCore } = parsed;
  const author = normalizeAuthorName(rawAuthor);
  
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    let recordsInserted = 0;
    
    // Handle CORE documents specially - parse sections with PARAMETERIZED QUERIES
    if (isCore) {
      const coreRecords = parseCoreDocument(content, author, fileName);
      
      for (const record of coreRecords) {
        try {
          // Use parameterized query to prevent SQL injection
          await db.execute(sql`
            INSERT INTO core_content (thinker, content_type, content, source_document, priority)
            VALUES (${author}, ${record.type}, ${record.content}, ${fileName}, 1)
          `);
          recordsInserted++;
        } catch (insertError: any) {
          console.error(`CORE insert error for ${fileName}:`, insertError.message);
        }
      }
      
      fs.unlinkSync(filePath);
      
      return {
        file: fileName,
        type: "CORE",
        author,
        recordsInserted,
        success: true
      };
    }
    
    // Standard file processing
    const lines = content.split("\n").filter(line => line.trim().length > 0);
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
        } else if (type === "OUTLINES") {
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
        } else if (type === "OUTLINES") {
          await db.execute(sql.raw(`INSERT INTO outlines (thinker, outline_text, source_document) VALUES ${values.join(",")}`));
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
  console.log(`Standard format: AUTHOR_TYPE_N.txt (e.g., Kuczynski_QUOTES_1.txt)`);
  console.log(`Standard types: QUOTES, POSITIONS, ARGUMENTS, WORKS, OUTLINES`);
  console.log(`CORE format: CORE_AUTHOR_N.txt (e.g., CORE_Kuczynski_1.txt) - Priority content from document analysis`);
  
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
