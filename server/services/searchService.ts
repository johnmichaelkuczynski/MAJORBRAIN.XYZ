import { db } from "../db";
import { sql } from "drizzle-orm";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

interface RetrievedItem {
  type: "position" | "quote" | "argument" | "work" | "core";
  id: number | string;
  text: string;
  thinker: string;
  topic: string | null;
  relevanceScore: number;
  source?: string;
}

interface RetrievalResult {
  positions: RetrievedItem[];
  quotes: RetrievedItem[];
  arguments: RetrievedItem[];
  works: RetrievedItem[];
  coreContent: RetrievedItem[];
  searchTerms: string[];
  expandedTerms: string[];
  auditLog: AuditLogEntry;
  queryWasMatched: boolean;
}

interface AuditLogEntry {
  originalTopic: string;
  parsedPrimaryTopic: string;
  expandedSearchTerms: string[];
  perThinkerResults: Record<string, {
    positionsFound: number;
    quotesFound: number;
    argumentsFound: number;
    worksFound: number;
    coreFound: number;
    topRelevanceScore: number;
    searchMethod: string;
  }>;
  totalRetrieved: number;
  belowThreshold: string[];
}

async function safeQuery<T>(queryFn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await queryFn();
  } catch (error: any) {
    if (error.message?.includes("does not exist") ||
        error.code === "42P01" ||
        error.message?.includes("relation") ||
        error.message?.includes("column")) {
      console.warn("[SEARCH-SVC] Table/column not found:", error.message?.substring(0, 100));
      return fallback;
    }
    console.error("[SEARCH-SVC] Query error:", error.message?.substring(0, 200));
    return fallback;
  }
}

export async function initFullTextSearch(retryCount: number = 0): Promise<void> {
  console.log("[FTS] Initializing full-text search infrastructure...");

  if (retryCount > 0) {
    console.log(`[FTS] Retry attempt ${retryCount}/3...`);
    await new Promise(resolve => setTimeout(resolve, 3000 * retryCount));
  }

  try {
    await db.execute(sql`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'positions' AND column_name = 'search_vector'
        ) THEN
          ALTER TABLE positions ADD COLUMN search_vector tsvector;
        END IF;
      END $$;
    `);

    await db.execute(sql`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'arguments' AND column_name = 'search_vector'
        ) THEN
          ALTER TABLE arguments ADD COLUMN search_vector tsvector;
        END IF;
      END $$;
    `);

    await db.execute(sql`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'quotes' AND column_name = 'search_vector'
        ) THEN
          ALTER TABLE quotes ADD COLUMN search_vector tsvector;
        END IF;
      END $$;
    `);

    await db.execute(sql`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'works' AND column_name = 'search_vector'
        ) THEN
          ALTER TABLE works ADD COLUMN search_vector tsvector;
        END IF;
      END $$;
    `);

    console.log("[FTS] Added search_vector columns");

    await db.execute(sql`
      UPDATE positions SET search_vector = to_tsvector('english', COALESCE(position_text, ''))
      WHERE search_vector IS NULL;
    `);
    await db.execute(sql`
      UPDATE arguments SET search_vector = to_tsvector('english', COALESCE(argument_text, ''))
      WHERE search_vector IS NULL;
    `);
    await db.execute(sql`
      UPDATE quotes SET search_vector = to_tsvector('english', COALESCE(quote_text, ''))
      WHERE search_vector IS NULL;
    `);
    await db.execute(sql`
      UPDATE works SET search_vector = to_tsvector('english', COALESCE(work_text, '') || ' ' || COALESCE(title, ''))
      WHERE search_vector IS NULL;
    `);

    console.log("[FTS] Populated search vectors");

    await safeQuery(async () => {
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_positions_fts ON positions USING GIN(search_vector);`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_arguments_fts ON arguments USING GIN(search_vector);`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_quotes_fts ON quotes USING GIN(search_vector);`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_works_fts ON works USING GIN(search_vector);`);
    }, undefined);

    console.log("[FTS] Created GIN indexes");

    await safeQuery(async () => {
      await db.execute(sql`
        CREATE OR REPLACE FUNCTION update_positions_search_vector() RETURNS trigger AS $$
        BEGIN
          NEW.search_vector := to_tsvector('english', COALESCE(NEW.position_text, ''));
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
      `);
      await db.execute(sql`
        DROP TRIGGER IF EXISTS trg_positions_search ON positions;
        CREATE TRIGGER trg_positions_search BEFORE INSERT OR UPDATE ON positions
        FOR EACH ROW EXECUTE FUNCTION update_positions_search_vector();
      `);

      await db.execute(sql`
        CREATE OR REPLACE FUNCTION update_arguments_search_vector() RETURNS trigger AS $$
        BEGIN
          NEW.search_vector := to_tsvector('english', COALESCE(NEW.argument_text, ''));
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
      `);
      await db.execute(sql`
        DROP TRIGGER IF EXISTS trg_arguments_search ON arguments;
        CREATE TRIGGER trg_arguments_search BEFORE INSERT OR UPDATE ON arguments
        FOR EACH ROW EXECUTE FUNCTION update_arguments_search_vector();
      `);

      await db.execute(sql`
        CREATE OR REPLACE FUNCTION update_quotes_search_vector() RETURNS trigger AS $$
        BEGIN
          NEW.search_vector := to_tsvector('english', COALESCE(NEW.quote_text, ''));
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
      `);
      await db.execute(sql`
        DROP TRIGGER IF EXISTS trg_quotes_search ON quotes;
        CREATE TRIGGER trg_quotes_search BEFORE INSERT OR UPDATE ON quotes
        FOR EACH ROW EXECUTE FUNCTION update_quotes_search_vector();
      `);

      await db.execute(sql`
        CREATE OR REPLACE FUNCTION update_works_search_vector() RETURNS trigger AS $$
        BEGIN
          NEW.search_vector := to_tsvector('english', COALESCE(NEW.work_text, '') || ' ' || COALESCE(NEW.title, ''));
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
      `);
      await db.execute(sql`
        DROP TRIGGER IF EXISTS trg_works_search ON works;
        CREATE TRIGGER trg_works_search BEFORE INSERT OR UPDATE ON works
        FOR EACH ROW EXECUTE FUNCTION update_works_search_vector();
      `);
    }, undefined);

    console.log("[FTS] Created auto-update triggers");
    console.log("[FTS] Full-text search infrastructure ready");

  } catch (error: any) {
    if (error.message?.includes("deadlock") && retryCount < 3) {
      console.warn(`[FTS] Deadlock detected, will retry (attempt ${retryCount + 1}/3)...`);
      return initFullTextSearch(retryCount + 1);
    }
    console.error("[FTS] Failed to initialize full-text search:", error.message);
  }
}

export async function expandTopicWithLLM(topic: string): Promise<string[]> {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 300,
      temperature: 0,
      messages: [{
        role: "user",
        content: `Given this dialogue/chat topic, generate 15-20 semantically related search terms that would help find relevant philosophical content in a database. Include synonyms, related concepts, sub-topics, and key philosophical terms.

Topic: "${topic}"

Return ONLY a comma-separated list of search terms. No explanations. Include the original key terms plus expansions.
Example for "mental illness recovery": mental illness, OCD, psychosis, neurosis, addiction, recovery, therapy, defense mechanisms, will, superego, unconscious, anxiety, depression, healing, psychological, disorder, treatment, compulsive, obsessive, pathology`
      }]
    });

    const terms = (response.choices[0]?.message?.content || "")
      .split(",")
      .map(t => t.trim().toLowerCase())
      .filter(t => t.length > 2 && t.length < 50);

    console.log(`[TOPIC-EXPAND] "${topic}" -> ${terms.length} terms: ${terms.join(', ')}`);
    return terms;
  } catch (error: any) {
    console.error("[TOPIC-EXPAND] LLM expansion failed, using basic extraction:", error.message);
    return extractBasicTerms(topic);
  }
}

function extractBasicTerms(query: string): string[] {
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
    'may', 'might', 'must', 'can', 'to', 'of', 'in', 'for', 'on', 'with', 'at',
    'by', 'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above',
    'below', 'between', 'under', 'again', 'further', 'then', 'once', 'here',
    'there', 'when', 'where', 'why', 'how', 'all', 'each', 'few', 'more', 'most',
    'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so',
    'than', 'too', 'very', 'just', 'and', 'but', 'if', 'or', 'because', 'until',
    'while', 'about', 'against', 'what', 'which', 'who', 'whom', 'this', 'that',
    'these', 'those', 'am', 'your', 'you', 'i', 'me', 'my', 'we', 'our', 'they',
    'their', 'its', 'it', 'he', 'she', 'him', 'her', 'his', 'them', 'us',
    'people', 'capable', 'getting', 'over', 'nature', 'really', 'think', 'know',
    'make', 'like', 'tell', 'way', 'well', 'also', 'back', 'much',
  ]);

  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w));
}

function buildTsQuery(terms: string[]): string {
  if (terms.length === 0) return "";

  const sanitized = terms
    .map(t => t.replace(/[^a-z0-9]/g, ''))
    .filter(t => t.length > 2);

  if (sanitized.length === 0) return "";

  return sanitized.join(" | ");
}

export async function topicFirstRetrieval(
  thinkerId: string,
  thinkerName: string,
  topic: string,
  maxResults: number = 30
): Promise<RetrievalResult> {
  const auditLog: AuditLogEntry = {
    originalTopic: topic,
    parsedPrimaryTopic: "",
    expandedSearchTerms: [],
    perThinkerResults: {},
    totalRetrieved: 0,
    belowThreshold: [],
  };

  console.log(`\n[RETRIEVAL] ========================================`);
  console.log(`[RETRIEVAL] Topic: "${topic}"`);
  console.log(`[RETRIEVAL] Thinker: ${thinkerName} (${thinkerId})`);

  const expandedTerms = await expandTopicWithLLM(topic);
  const basicTerms = extractBasicTerms(topic);
  const allTerms = Array.from(new Set([...expandedTerms, ...basicTerms]));
  auditLog.expandedSearchTerms = allTerms;
  auditLog.parsedPrimaryTopic = topic;

  console.log(`[RETRIEVAL] Expanded to ${allTerms.length} search terms`);

  const tsQueryStr = buildTsQuery(allTerms);

  let positions: RetrievedItem[] = [];
  let quotes: RetrievedItem[] = [];
  let arguments_: RetrievedItem[] = [];
  let works: RetrievedItem[] = [];
  let coreContent: RetrievedItem[] = [];

  if (tsQueryStr) {
    positions = await searchWithFTS("positions", "position_text", thinkerName, thinkerId, tsQueryStr, maxResults);
    quotes = await searchWithFTS("quotes", "quote_text", thinkerName, thinkerId, tsQueryStr, maxResults);
    arguments_ = await searchWithFTS("arguments", "argument_text", thinkerName, thinkerId, tsQueryStr, maxResults);
    works = await searchWithFTS("works", "work_text", thinkerName, thinkerId, tsQueryStr, Math.floor(maxResults / 2));
  }

  console.log(`[RETRIEVAL] FTS results: ${positions.length} positions, ${quotes.length} quotes, ${arguments_.length} arguments, ${works.length} works`);

  if (positions.length < 5 || quotes.length < 3) {
    console.log(`[RETRIEVAL] FTS insufficient, augmenting with ILIKE multi-term search...`);
    const ilikePositions = await searchWithILIKE("positions", "position_text", thinkerName, thinkerId, allTerms, maxResults);
    const ilikeQuotes = await searchWithILIKE("quotes", "quote_text", thinkerName, thinkerId, allTerms, maxResults);
    const ilikeArguments = await searchWithILIKE("arguments", "argument_text", thinkerName, thinkerId, allTerms, maxResults);
    const ilikeWorks = await searchWithILIKE("works", "work_text", thinkerName, thinkerId, allTerms, Math.floor(maxResults / 2));

    positions = deduplicateItems([...positions, ...ilikePositions]);
    quotes = deduplicateItems([...quotes, ...ilikeQuotes]);
    arguments_ = deduplicateItems([...arguments_, ...ilikeArguments]);
    works = deduplicateItems([...works, ...ilikeWorks]);

    console.log(`[RETRIEVAL] After ILIKE augmentation: ${positions.length} positions, ${quotes.length} quotes, ${arguments_.length} arguments, ${works.length} works`);
  }

  coreContent = await searchCoreContent(thinkerName, thinkerId, allTerms, maxResults);
  console.log(`[RETRIEVAL] Core content: ${coreContent.length} items`);

  const totalRelevant = positions.length + quotes.length + arguments_.length + works.length + coreContent.length;

  if (totalRelevant < 3) {
    console.log(`[RETRIEVAL] WARNING: Only ${totalRelevant} relevant items found. Falling back to general thinker content...`);
    const fallbackPositions = await searchGeneralThinkerContent("positions", "position_text", thinkerName, thinkerId, Math.floor(maxResults / 2));
    const fallbackQuotes = await searchGeneralThinkerContent("quotes", "quote_text", thinkerName, thinkerId, Math.floor(maxResults / 3));
    const fallbackArguments = await searchGeneralThinkerContent("arguments", "argument_text", thinkerName, thinkerId, Math.floor(maxResults / 4));

    positions = deduplicateItems([...positions, ...fallbackPositions]);
    quotes = deduplicateItems([...quotes, ...fallbackQuotes]);
    arguments_ = deduplicateItems([...arguments_, ...fallbackArguments]);

    console.log(`[RETRIEVAL] After fallback: ${positions.length} positions, ${quotes.length} quotes, ${arguments_.length} arguments`);
    auditLog.belowThreshold.push(thinkerName);
  }

  auditLog.perThinkerResults[thinkerName] = {
    positionsFound: positions.length,
    quotesFound: quotes.length,
    argumentsFound: arguments_.length,
    worksFound: works.length,
    coreFound: coreContent.length,
    topRelevanceScore: Math.max(
      ...positions.map(p => p.relevanceScore),
      ...quotes.map(q => q.relevanceScore),
      0
    ),
    searchMethod: tsQueryStr ? "FTS+ILIKE" : "ILIKE",
  };
  auditLog.totalRetrieved = positions.length + quotes.length + arguments_.length + works.length + coreContent.length;

  console.log(`[RETRIEVAL] AUDIT: Total retrieved = ${auditLog.totalRetrieved}`);
  console.log(`[RETRIEVAL] Top relevance scores:`);
  if (positions.length > 0) {
    console.log(`  Positions: ${positions.slice(0, 3).map(p => `[${p.relevanceScore.toFixed(3)}] ${p.text.substring(0, 80)}...`).join('\n  ')}`);
  }
  if (quotes.length > 0) {
    console.log(`  Quotes: ${quotes.slice(0, 3).map(q => `[${q.relevanceScore.toFixed(3)}] ${q.text.substring(0, 80)}...`).join('\n  ')}`);
  }
  console.log(`[RETRIEVAL] ========================================\n`);

  return {
    positions,
    quotes,
    arguments: arguments_,
    works,
    coreContent,
    searchTerms: basicTerms,
    expandedTerms: allTerms,
    auditLog,
    queryWasMatched: totalRelevant > 0,
  };
}

async function searchWithFTS(
  table: string,
  textColumn: string,
  thinkerName: string,
  thinkerId: string,
  tsQueryStr: string,
  limit: number
): Promise<RetrievedItem[]> {
  return safeQuery(async () => {
    const result = await db.execute(sql.raw(`
      SELECT id, thinker, ${textColumn} AS text, topic,
        ts_rank_cd(search_vector, to_tsquery('english', '${tsQueryStr.replace(/'/g, "''")}')) AS relevance
      FROM ${table}
      WHERE (thinker ILIKE '%${thinkerName.replace(/'/g, "''")}%' OR thinker ILIKE '%${thinkerId.replace(/'/g, "''")}%')
        AND search_vector @@ to_tsquery('english', '${tsQueryStr.replace(/'/g, "''")}')
      ORDER BY relevance DESC
      LIMIT ${limit}
    `));

    const rows = (result as any).rows || result || [];
    return rows.map((row: any) => ({
      type: table === "positions" ? "position" :
            table === "quotes" ? "quote" :
            table === "arguments" ? "argument" : "work",
      id: row.id,
      text: row.text || "",
      thinker: row.thinker || "",
      topic: row.topic || null,
      relevanceScore: parseFloat(row.relevance) || 0,
      source: row.topic || undefined,
    } as RetrievedItem));
  }, []);
}

async function searchWithILIKE(
  table: string,
  textColumn: string,
  thinkerName: string,
  thinkerId: string,
  terms: string[],
  limit: number
): Promise<RetrievedItem[]> {
  if (terms.length === 0) return [];

  return safeQuery(async () => {
    const termConditions = terms
      .slice(0, 20)
      .map(t => `${textColumn} ILIKE '%${t.replace(/'/g, "''")}%'`)
      .join(" OR ");

    const termCountExpr = terms
      .slice(0, 20)
      .map(t => `CASE WHEN ${textColumn} ILIKE '%${t.replace(/'/g, "''")}%' THEN 1 ELSE 0 END`)
      .join(" + ");

    const result = await db.execute(sql.raw(`
      SELECT id, thinker, ${textColumn} AS text, topic,
        (${termCountExpr}) AS match_count
      FROM ${table}
      WHERE (thinker ILIKE '%${thinkerName.replace(/'/g, "''")}%' OR thinker ILIKE '%${thinkerId.replace(/'/g, "''")}%')
        AND (${termConditions})
      ORDER BY match_count DESC
      LIMIT ${limit}
    `));

    const rows = (result as any).rows || result || [];
    const maxCount = Math.max(...rows.map((r: any) => parseInt(r.match_count) || 0), 1);

    return rows.map((row: any) => ({
      type: table === "positions" ? "position" :
            table === "quotes" ? "quote" :
            table === "arguments" ? "argument" : "work",
      id: row.id,
      text: row.text || "",
      thinker: row.thinker || "",
      topic: row.topic || null,
      relevanceScore: (parseInt(row.match_count) || 0) / maxCount * 0.5,
      source: row.topic || undefined,
    } as RetrievedItem));
  }, []);
}

async function searchCoreContent(
  thinkerName: string,
  thinkerId: string,
  terms: string[],
  limit: number
): Promise<RetrievedItem[]> {
  return safeQuery(async () => {
    const termConditions = terms.length > 0
      ? terms.slice(0, 15).map(t => `content_text ILIKE '%${t.replace(/'/g, "''")}%'`).join(" OR ")
      : "1=1";

    const result = await db.execute(sql.raw(`
      SELECT id, thinker, content_type, content_text, question, answer, source_document, importance
      FROM core_content
      WHERE (thinker ILIKE '%${thinkerName.replace(/'/g, "''")}%' OR thinker ILIKE '%${thinkerId.replace(/'/g, "''")}%')
        ${terms.length > 0 ? `AND (${termConditions})` : ""}
      ORDER BY importance DESC
      LIMIT ${limit}
    `));

    const rows = (result as any).rows || result || [];
    return rows.map((row: any) => ({
      type: "core" as const,
      id: row.id,
      text: row.content_text || row.answer || "",
      thinker: row.thinker || "",
      topic: row.content_type || null,
      relevanceScore: (parseInt(row.importance) || 1) / 10,
      source: row.source_document || row.content_type || undefined,
    }));
  }, []);
}

async function searchGeneralThinkerContent(
  table: string,
  textColumn: string,
  thinkerName: string,
  thinkerId: string,
  limit: number
): Promise<RetrievedItem[]> {
  return safeQuery(async () => {
    const result = await db.execute(sql.raw(`
      SELECT id, thinker, ${textColumn} AS text, topic
      FROM ${table}
      WHERE (thinker ILIKE '%${thinkerName.replace(/'/g, "''")}%' OR thinker ILIKE '%${thinkerId.replace(/'/g, "''")}%')
      ORDER BY id
      LIMIT ${limit}
    `));

    const rows = (result as any).rows || result || [];
    return rows.map((row: any) => ({
      type: table === "positions" ? "position" :
            table === "quotes" ? "quote" :
            table === "arguments" ? "argument" : "work",
      id: row.id,
      text: row.text || "",
      thinker: row.thinker || "",
      topic: row.topic || null,
      relevanceScore: 0.1,
      source: row.topic || undefined,
    } as RetrievedItem));
  }, []);
}

function deduplicateItems(items: RetrievedItem[]): RetrievedItem[] {
  const seen = new Set<string>();
  const result: RetrievedItem[] = [];

  items.sort((a, b) => b.relevanceScore - a.relevanceScore);

  for (const item of items) {
    const key = `${item.type}-${item.id}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }

  return result;
}

export async function populateTopicsFromPositionText(): Promise<{ processed: number; errors: number }> {
  let processed = 0;
  let errors = 0;

  try {
    const result = await db.execute(sql`
      SELECT id, position_text FROM positions WHERE topic IS NULL AND position_text IS NOT NULL
    `);
    const rows = (result as any).rows || result || [];

    for (const row of rows) {
      try {
        const text = row.position_text || "";
        const parts = text.split("|").map((s: string) => s.trim());
        if (parts.length >= 3) {
          const extractedTopic = parts[parts.length - 1];
          if (extractedTopic && extractedTopic.length > 2 && extractedTopic.length < 200) {
            await db.execute(sql`UPDATE positions SET topic = ${extractedTopic} WHERE id = ${row.id}`);
            processed++;
          }
        }
      } catch (e: any) {
        errors++;
      }
    }

    const argResult = await db.execute(sql`
      SELECT id, argument_text FROM arguments WHERE topic IS NULL AND argument_text IS NOT NULL
    `);
    const argRows = (argResult as any).rows || argResult || [];

    for (const row of argRows) {
      try {
        const text = row.argument_text || "";
        const parts = text.split("|").map((s: string) => s.trim());
        if (parts.length >= 3) {
          const extractedTopic = parts[parts.length - 1];
          if (extractedTopic && extractedTopic.length > 2 && extractedTopic.length < 200) {
            await db.execute(sql`UPDATE arguments SET topic = ${extractedTopic} WHERE id = ${row.id}`);
            processed++;
          }
        }
      } catch (e: any) {
        errors++;
      }
    }

    console.log(`[TOPIC-POP] Extracted topics from text format: ${processed} rows updated, ${errors} errors`);
  } catch (error: any) {
    console.error("[TOPIC-POP] Failed:", error.message);
  }

  return { processed, errors };
}

export async function populateTopicsWithLLM(batchSize: number = 50): Promise<{ processed: number; errors: number }> {
  let processed = 0;
  let errors = 0;

  try {
    const result = await db.execute(sql`
      SELECT id, position_text FROM positions WHERE topic IS NULL LIMIT ${batchSize}
    `);
    const rows = (result as any).rows || result || [];

    if (rows.length === 0) {
      console.log("[TOPIC-LLM] No rows without topics found");
      return { processed: 0, errors: 0 };
    }

    for (const row of rows) {
      try {
        const response = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          max_tokens: 100,
          temperature: 0,
          messages: [{
            role: "user",
            content: `Classify this philosophical text into 1-3 short topic labels (comma-separated). Be specific. Examples: "mental illness, OCD, recovery" or "epistemology, logic, reasoning" or "ethics, virtue, duty".

Text: ${(row.position_text || "").substring(0, 500)}

Return ONLY the topic labels, nothing else.`
          }]
        });

        const topic = response.choices[0]?.message?.content?.trim();
        if (topic && topic.length > 2 && topic.length < 200) {
          await db.execute(sql`UPDATE positions SET topic = ${topic} WHERE id = ${row.id}`);
          processed++;
        }
      } catch (e: any) {
        errors++;
      }
    }

    console.log(`[TOPIC-LLM] Classified ${processed} positions, ${errors} errors`);
  } catch (error: any) {
    console.error("[TOPIC-LLM] Failed:", error.message);
  }

  return { processed, errors };
}

export function convertRetrievalToLegacyFormat(result: RetrievalResult): any {
  return {
    positions: result.positions.map(p => ({
      id: p.id,
      thinker: p.thinker,
      positionText: p.text,
      position_text: p.text,
      topic: p.topic,
      relevanceScore: p.relevanceScore,
    })),
    quotes: result.quotes.map(q => ({
      id: q.id,
      thinker: q.thinker,
      quoteText: q.text,
      quote_text: q.text,
      topic: q.topic,
      relevanceScore: q.relevanceScore,
    })),
    arguments: result.arguments.map(a => ({
      id: a.id,
      thinker: a.thinker,
      argumentText: a.text,
      argument_text: a.text,
      topic: a.topic,
      relevanceScore: a.relevanceScore,
    })),
    works: result.works.map(w => ({
      id: w.id,
      thinker: w.thinker,
      workText: w.text,
      work_text: w.text,
      title: w.source || "",
      relevanceScore: w.relevanceScore,
    })),
    coreContent: result.coreContent.map(c => ({
      id: c.id,
      thinker: c.thinker,
      content: c.text,
      content_text: c.text,
      content_type: c.topic || "general",
      importance: Math.round(c.relevanceScore * 10),
    })),
    textChunks: [],
    searchTerms: result.searchTerms,
    expandedTerms: result.expandedTerms,
    queryWasMatched: result.queryWasMatched,
    auditLog: result.auditLog,
  };
}
