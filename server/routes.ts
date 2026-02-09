import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { db } from "./db";
import { 
  positions, quotes, textChunks, arguments_, works, THINKERS,
  chatRequestSchema, modelBuilderRequestSchema, dialogueRequestSchema,
  debateRequestSchema, interviewRequestSchema, outlineGeneratorRequestSchema,
  fullDocumentRequestSchema
} from "@shared/schema";
import { eq, ilike, or, sql } from "drizzle-orm";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import multer from "multer";
import { z } from "zod";
import { processIngestFolder } from "./ingest";

// Initialize AI clients
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// File upload configuration
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Helper to normalize thinker names for database queries (case-insensitive)
function normalizeThinkerName(figureId: string): string {
  const normalizedId = figureId.toLowerCase();
  const thinker = THINKERS.find(t => t.id.toLowerCase() === normalizedId || t.name.toLowerCase() === normalizedId);
  return thinker?.name || figureId;
}

// Helper to stream OpenAI responses
async function* streamOpenAI(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  model: string = "gpt-4o"
): AsyncGenerator<string> {
  const stream = await openai.chat.completions.create({
    model,
    messages,
    stream: true,
    max_tokens: 16000,
  });

  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content;
    if (content) {
      yield content;
    }
  }
}

// Helper to stream Anthropic responses
async function* streamAnthropic(
  systemPrompt: string,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  model: string = "claude-sonnet-4"
): AsyncGenerator<string> {
  const stream = await anthropic.messages.stream({
    model,
    max_tokens: 16000,
    system: systemPrompt,
    messages,
  });

  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      yield event.delta.text;
    }
  }
}

// Set up SSE headers to prevent buffering
function setupSSE(res: Response) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // Disable Nginx buffering
  res.setHeader("Transfer-Encoding", "chunked");
  res.flushHeaders(); // Send headers immediately
}

// Helper to send SSE response with immediate flush
function sendSSE(res: Response, data: string) {
  res.write(`data: ${JSON.stringify({ content: data })}\n\n`);
  // Force flush for real-time streaming
  if (typeof (res as any).flush === 'function') {
    (res as any).flush();
  }
}

// Helper to safely query database tables that may not exist
async function safeDbQuery<T>(queryFn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await queryFn();
  } catch (error: any) {
    // Handle missing table errors gracefully
    if (error.message?.includes("does not exist") || 
        error.code === "42P01" || // PostgreSQL undefined_table
        error.message?.includes("relation")) {
      console.warn("Database table not found, using fallback:", error.message);
      return fallback;
    }
    console.error("Database query error:", error);
    return fallback;
  }
}

// Common philosophical abbreviations and their expansions
const ABBREVIATION_EXPANSIONS: Record<string, string[]> = {
  'dn': ['deductive-nomological', 'deductive', 'nomological'],
  'ocd': ['obsessive-compulsive', 'obsessive', 'compulsive', 'disorder'],
  'ai': ['artificial', 'intelligence'],
  'iq': ['intelligence', 'quotient'],
  'jnb': ['justified', 'true', 'belief'],
  'jtb': ['justified', 'true', 'belief'],
};

// Extract keywords from user query for semantic search
function extractSearchTerms(query: string): string[] {
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
    'their', 'it', 'its', 'he', 'she', 'him', 'her', 'his', 'hers', 'think', 
    'view', 'views', 'opinion', 'believe', 'solve', 'explain', 'tell', 'say',
    'said', 'says', 'does', 'please', 'thanks', 'thank'
  ]);
  
  let terms = query
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 1 && !stopWords.has(word));
  
  // Expand abbreviations
  const expandedTerms: string[] = [];
  for (const term of terms) {
    expandedTerms.push(term);
    const expansion = ABBREVIATION_EXPANSIONS[term];
    if (expansion) {
      expandedTerms.push(...expansion);
    }
  }
  
  // Also add hyphenated compound forms for common philosophical terms
  if (terms.includes('deductive') || terms.includes('nomological')) {
    expandedTerms.push('deductive-nomological');
  }
  if (terms.includes('raven') || terms.includes('paradox')) {
    expandedTerms.push('raven', 'paradox', 'confirmation');
  }
  if (terms.includes('hume') || terms.includes('causation')) {
    expandedTerms.push('causation', 'causal', 'cause', 'hume', 'humean');
  }
  if (terms.includes('induction') || terms.includes('inductive')) {
    expandedTerms.push('induction', 'inductive', 'inductivism');
  }
  if (terms.includes('popper') || terms.includes('falsification')) {
    expandedTerms.push('falsification', 'falsifiability', 'popper', 'popperian');
  }
  if (terms.includes('freud') || terms.includes('psychoanalysis')) {
    expandedTerms.push('freud', 'freudian', 'psychoanalysis', 'psychoanalytic');
  }
  if (terms.includes('crowd') || terms.includes('crowds')) {
    expandedTerms.push('crowd', 'crowds', 'mob', 'collective');
  }
  if (terms.includes('criminal') || terms.includes('criminals')) {
    expandedTerms.push('criminal', 'criminals', 'crime', 'criminality');
  }
  if (terms.includes('analytic') || terms.includes('philosophy')) {
    expandedTerms.push('analytic', 'philosophy', 'analytical');
  }
  if (terms.includes('pragmatic') || terms.includes('truth')) {
    expandedTerms.push('pragmatic', 'pragmatism', 'truth', 'pragmatist');
  }
  if (terms.includes('probabilistic') || terms.includes('probability')) {
    expandedTerms.push('probabilistic', 'probability', 'probabilism');
  }
  if (terms.includes('algorithmic') || terms.includes('algorithm')) {
    expandedTerms.push('algorithmic', 'algorithm', 'computation', 'computational');
  }
  if (terms.includes('intelligence') || terms.includes('rationality')) {
    expandedTerms.push('intelligence', 'rationality', 'rational', 'intelligent');
  }
  
  // Deduplicate and limit
  return Array.from(new Set(expandedTerms)).slice(0, 20);
}

// TOPIC-FIRST SEMANTIC SEARCH: Uses full-text search + LLM topic expansion
// Searches by TOPIC FIRST, then filters by thinker. This ensures relevant material
// is retrieved instead of generic/default positions.
async function getThinkerContext(thinkerId: string, query: string, quoteCount: number = 50) {
  const thinkerName = normalizeThinkerName(thinkerId);

  try {
    const { topicFirstRetrieval, convertRetrievalToLegacyFormat } = await import("./services/searchService");
    const result = await topicFirstRetrieval(thinkerId, thinkerName, query, quoteCount);
    return convertRetrievalToLegacyFormat(result);
  } catch (error: any) {
    console.error("[SEARCH] New search service failed, using legacy fallback:", error.message);
    return legacyGetThinkerContext(thinkerId, query, quoteCount);
  }
}

// Legacy fallback search (ILIKE-only) - used only if new search service fails
async function legacyGetThinkerContext(thinkerId: string, query: string, quoteCount: number = 50) {
  const thinkerName = normalizeThinkerName(thinkerId);
  const searchTerms = extractSearchTerms(query);
  
  console.log(`[LEGACY-SEARCH] Query: "${query}"`);
  console.log(`[LEGACY-SEARCH] Thinker: ${thinkerName}`);

  const buildSearchConditions = (textColumn: any, thinkerColumn: any) => {
    const thinkerMatch = or(
      ilike(thinkerColumn, `%${thinkerName}%`),
      ilike(thinkerColumn, `%${thinkerId}%`)
    );
    
    if (searchTerms.length === 0) {
      return thinkerMatch;
    }
    
    const termMatches = searchTerms.map(term => ilike(textColumn, `%${term}%`));
    return sql`${thinkerMatch} AND (${sql.join(termMatches, sql` OR `)})`;
  };

  let relevantPositions = await safeDbQuery(
    () => db
      .select()
      .from(positions)
      .where(buildSearchConditions(positions.positionText, positions.thinker))
      .limit(quoteCount * 2),
    []
  );

  let relevantQuotes = await safeDbQuery(
    () => db
      .select()
      .from(quotes)
      .where(buildSearchConditions(quotes.quoteText, quotes.thinker))
      .limit(quoteCount),
    []
  );

  let relevantArguments = await safeDbQuery(
    () => db
      .select()
      .from(arguments_)
      .where(buildSearchConditions(arguments_.argumentText, arguments_.thinker))
      .limit(quoteCount),
    []
  );

  let relevantWorks = await safeDbQuery(
    () => db
      .select()
      .from(works)
      .where(buildSearchConditions(works.workText, works.thinker))
      .limit(quoteCount),
    []
  );

  if (relevantPositions.length === 0 && relevantQuotes.length === 0 && 
      relevantArguments.length === 0 && relevantWorks.length === 0) {
    relevantPositions = await safeDbQuery(
      () => db.select().from(positions)
        .where(or(ilike(positions.thinker, `%${thinkerName}%`), ilike(positions.thinker, `%${thinkerId}%`)))
        .limit(Math.floor(quoteCount / 2)),
      []
    );
    relevantQuotes = await safeDbQuery(
      () => db.select().from(quotes)
        .where(or(ilike(quotes.thinker, `%${thinkerName}%`), ilike(quotes.thinker, `%${thinkerId}%`)))
        .limit(Math.floor(quoteCount / 2)),
      []
    );
  }

  return {
    positions: relevantPositions,
    quotes: relevantQuotes,
    arguments: relevantArguments,
    works: relevantWorks,
    textChunks: [],
    coreContent: [],
    searchTerms,
    queryWasMatched: relevantPositions.length > 0 || relevantQuotes.length > 0,
  };
}

// Split uploaded document content into meaningful chunks for per-debater material
function splitUploadedContent(text: string, targetWordsPerChunk: number = 200): string[] {
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
  const chunks: string[] = [];
  let currentChunk = "";
  let currentWords = 0;

  for (const para of paragraphs) {
    const paraWords = para.split(/\s+/).filter(Boolean).length;
    if (currentWords + paraWords > targetWordsPerChunk && currentChunk.trim()) {
      chunks.push(currentChunk.trim());
      currentChunk = para;
      currentWords = paraWords;
    } else {
      currentChunk += (currentChunk ? "\n\n" : "") + para;
      currentWords += paraWords;
    }
  }
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  // If we got a single huge chunk (no paragraph breaks), split by sentences
  if (chunks.length === 1 && chunks[0].split(/\s+/).length > targetWordsPerChunk * 1.5) {
    const bigText = chunks[0];
    const sentences = bigText.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);
    const sentenceChunks: string[] = [];
    let sc = "";
    let sw = 0;
    for (const sentence of sentences) {
      const sWords = sentence.split(/\s+/).filter(Boolean).length;
      if (sw + sWords > targetWordsPerChunk && sc.trim()) {
        sentenceChunks.push(sc.trim());
        sc = sentence;
        sw = sWords;
      } else {
        sc += (sc ? " " : "") + sentence;
        sw += sWords;
      }
    }
    if (sc.trim()) sentenceChunks.push(sc.trim());
    if (sentenceChunks.length > 1) return sentenceChunks;
  }

  if (chunks.length === 0 && text.trim()) {
    chunks.push(text.trim());
  }

  return chunks;
}

// Build a SKELETON from database content that the AI MUST use
function buildDatabaseSkeleton(context: any, thinkerName: string, quoteCount: number): string {
  let skeleton = `\n\n=== MANDATORY DATABASE CONTENT - YOU MUST USE THIS AS YOUR SKELETON ===\n`;
  skeleton += `The following content is from ${thinkerName}'s actual writings in the database.\n`;
  skeleton += `You MUST incorporate AT LEAST ${quoteCount} of these items into your response.\n`;
  skeleton += `DO NOT make up positions or quotes - use ONLY what is provided below.\n`;
  skeleton += `CRITICAL: DO NOT USE ANY MARKDOWN FORMATTING. No #, no *, no -, no **. Plain text only.\n\n`;
  
  // PRIORITY: CORE content first (from analyzed documents)
  if (context.coreContent?.length > 0) {
    const corePositions = context.coreContent.filter((c: any) => c.content_type === 'position');
    const coreArguments = context.coreContent.filter((c: any) => c.content_type === 'argument');
    const coreTrends = context.coreContent.filter((c: any) => c.content_type === 'trend');
    const coreQAs = context.coreContent.filter((c: any) => c.content_type === 'qa');
    const coreOutline = context.coreContent.filter((c: any) => c.content_type === 'outline');
    
    if (coreOutline.length > 0) {
      skeleton += `\n--- ${thinkerName}'s DOCUMENT OUTLINE (PRIORITY) ---\n`;
      skeleton += `[OUTLINE] ${coreOutline[0].content?.substring(0, 2000) || ''}\n`;
    }
    
    if (corePositions.length > 0) {
      skeleton += `\n--- ${thinkerName}'s CORE POSITIONS (PRIORITY - ${corePositions.length} total) ---\n`;
      corePositions.slice(0, quoteCount).forEach((p: any, i: number) => {
        skeleton += `[CP${i + 1}] ${p.content}\n`;
      });
    }
    
    if (coreArguments.length > 0) {
      skeleton += `\n--- ${thinkerName}'s CORE ARGUMENTS (PRIORITY - ${coreArguments.length} total) ---\n`;
      coreArguments.slice(0, quoteCount).forEach((a: any, i: number) => {
        skeleton += `[CA${i + 1}] ${a.content}\n`;
      });
    }
    
    if (coreTrends.length > 0) {
      skeleton += `\n--- ${thinkerName}'s THOUGHT TRENDS (PRIORITY - ${coreTrends.length} total) ---\n`;
      coreTrends.slice(0, 10).forEach((t: any, i: number) => {
        skeleton += `[T${i + 1}] ${t.content}\n`;
      });
    }
    
    if (coreQAs.length > 0) {
      skeleton += `\n--- ${thinkerName}'s Q&A (PRIORITY - ${coreQAs.length} total) ---\n`;
      coreQAs.slice(0, quoteCount).forEach((qa: any, i: number) => {
        skeleton += `[QA${i + 1}] ${qa.content}\n`;
      });
    }
  }
  
  if (context.positions?.length > 0) {
    skeleton += `\n--- ${thinkerName}'s POSITIONS (${context.positions.length} total) ---\n`;
    context.positions.slice(0, quoteCount).forEach((p: any, i: number) => {
      skeleton += `[P${i + 1}] ${p.positionText || p.position_text}\n`;
    });
  }

  if (context.quotes?.length > 0) {
    skeleton += `\n--- ${thinkerName}'s QUOTES (${context.quotes.length} total) ---\n`;
    context.quotes.slice(0, quoteCount).forEach((q: any, i: number) => {
      skeleton += `[Q${i + 1}] "${q.quoteText || q.quote_text}"\n`;
    });
  }

  if (context.arguments?.length > 0) {
    skeleton += `\n--- ${thinkerName}'s ARGUMENTS (${context.arguments.length} total) ---\n`;
    context.arguments.slice(0, Math.floor(quoteCount / 2)).forEach((a: any, i: number) => {
      skeleton += `[A${i + 1}] ${a.argumentText || a.argument_text}\n`;
    });
  }

  if (context.works?.length > 0) {
    skeleton += `\n--- ${thinkerName}'s WORKS EXCERPTS (${context.works.length} total) ---\n`;
    context.works.slice(0, Math.floor(quoteCount / 3)).forEach((w: any, i: number) => {
      const text = (w.workText || w.work_text || '').substring(0, 500);
      skeleton += `[W${i + 1}] ${text}...\n`;
    });
  }

  skeleton += `\n=== END DATABASE CONTENT ===\n`;
  skeleton += `\nREMINDER: Your output MUST be built from the above content. Reference items by their codes [CP1], [CA1], [T1], [QA1], [P1], [Q1], [A1], [W1] etc. DO NOT invent content.\n`;
  skeleton += `PRIORITY: Use CORE content (CP, CA, T, QA) first if available - these are from comprehensive document analysis.\n`;
  skeleton += `ABSOLUTELY NO MARKDOWN. No # headers, no * bullets, no - lists, no ** bold. Use plain text with numbered sections like "1." "2." etc.\n`;
  
  return skeleton;
}

// Build system prompt for philosopher chat - FIRST PERSON, DIRECT, NO PUFFERY
function buildPhilosopherSystemPrompt(thinkerId: string, context: any, quoteCount: number = 10, wordCount: number = 2000, enhanced: boolean = false): string {
  const normalizedId = thinkerId.toLowerCase();
  const thinker = THINKERS.find(t => t.id.toLowerCase() === normalizedId || t.name.toLowerCase() === normalizedId);
  const name = thinker?.name || thinkerId;

  const totalDbContent = (context.positions?.length || 0) + (context.quotes?.length || 0) + 
                        (context.arguments?.length || 0) + (context.works?.length || 0);

  // Check if we found query-relevant content or just fallback
  const queryWasMatched = context.queryWasMatched !== false;

  let prompt = `You ARE ${name}. You speak in FIRST PERSON. You say "I believe", "My view is", "I argue".

=== YOUR ROLE ===
You are the VOICE, not the BRAIN. The database content below IS the brain.
Every substantive claim you make MUST trace back to a specific database item.
You articulate and connect the retrieved material in natural first-person voice.
You DO NOT generate your own version of what you think ${name} would say.
You DO NOT substitute generic LLM knowledge about ${name}.

=== ABSOLUTE REQUIREMENTS ===

FIRST PERSON ONLY:
- Say "I" not "${name}"
- Say "My view" not "${name}'s view"  
- Say "I argue" not "${name} argues"
- NEVER refer to yourself in third person. EVER.

WORD COUNT: Write AT LEAST ${wordCount} words. This is a MINIMUM.

CONCISE AND DIRECT:
- Get to the point immediately
- State positions clearly and directly
- No circuitous rambling
- No padding or filler

=== ABSOLUTELY FORBIDDEN ===

NEVER USE THESE PHRASES (ZERO TOLERANCE):
- "This raises profound questions..."
- "And so we see that..."
- "It is important to note..."
- "In this context, we must consider..."
- "This brings us to a broader point..."
- "Let me explain..."
- "That's an interesting question..."
- "To put it another way..."
- "In other words..."
- "The implications of this are..."
- "This leads us to consider..."
- "One might argue..."
- "It could be said that..."
- "I have long held that..."
- "I have long believed..."
- "It is my view that..."
- "It has always been my position..."
- "Throughout my career..."
- ANY vague philosophical-sounding filler
- ANY autobiographical padding or throat-clearing

NEVER:
- Speak in third person about yourself
- Use LLM puffery or filler phrases
- Start with setup instead of the actual answer
- Ramble without substance
- Use markdown formatting (no #, *, -, **)
- Make up positions not in the database

ANSWER DIRECTLY: Start with the actual answer in the FIRST sentence. No preamble.

=== YOUR ACTUAL CONTENT ===

${queryWasMatched ? "The database content below DIRECTLY answers the user's question. USE IT." : "NOTE: No content directly matching this query was found. State that you would need to consult your writings on this specific topic, but you can offer related thoughts from your general positions."}

${context.positions?.length > 0 ? `\n--- MY POSITIONS ---\n${context.positions.slice(0, quoteCount).map((p: any, i: number) => `[P${i + 1}] ${p.positionText || p.position_text}`).join('\n')}` : ''}

${context.quotes?.length > 0 ? `\n--- MY QUOTES ---\n${context.quotes.slice(0, quoteCount).map((q: any, i: number) => `[Q${i + 1}] "${q.quoteText || q.quote_text}"`).join('\n')}` : ''}

${context.arguments?.length > 0 ? `\n--- MY ARGUMENTS ---\n${context.arguments.slice(0, Math.floor(quoteCount / 2)).map((a: any, i: number) => `[A${i + 1}] ${a.argumentText || a.argument_text}`).join('\n')}` : ''}

${context.works?.length > 0 ? `\n--- MY WORKS ---\n${context.works.slice(0, Math.floor(quoteCount / 3)).map((w: any, i: number) => `[W${i + 1}] ${(w.workText || w.work_text || '').substring(0, 500)}...`).join('\n')}` : ''}

=== HOW TO RESPOND (STRICT DATABASE GROUNDING) ===

1. Answer the question DIRECTLY using the database content above
2. Cite sources with [P1], [Q1], [A1], [W1] codes
3. Speak as yourself in first person: "I believe...", "My argument is...", "I reject..."
4. Be direct and substantive - no filler
5. ${enhanced ? "ENHANCED: Use database as scaffolding (1 part), add your elaboration (3 parts) with examples, history, applications. Core claims must still cite database items." : "STRICT: Stay close to database content. Every substantive claim must cite a database item."}
6. Write at least ${wordCount} words of SUBSTANCE
7. DO NOT FREELANCE: If a sub-topic has no database content, acknowledge this honestly
8. DO NOT USE MARKDOWN: No # headers, no * bullets, no - lists, no ** bold. Plain text only.

Database contains ${totalDbContent} items. Cite them with [P#], [Q#], [A#], [W#] codes.

BEGIN YOUR RESPONSE IN FIRST PERSON. NO PREAMBLE. NO FREELANCING.`;

  return prompt;
}

// Determine if using OpenAI or Anthropic
function isOpenAIModel(model: string): boolean {
  return model.startsWith("gpt-");
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Get all philosophers/figures
  app.get("/api/figures", async (_req: Request, res: Response) => {
    res.json(THINKERS);
  });

  // Get single philosopher (case-insensitive)
  app.get("/api/figures/:figureId", async (req: Request, res: Response) => {
    const figureId = req.params.figureId as string;
    const normalizedId = figureId.toLowerCase();
    const thinker = THINKERS.find(t => t.id.toLowerCase() === normalizedId || t.name.toLowerCase() === normalizedId);
    if (!thinker) {
      return res.status(404).json({ error: "Thinker not found" });
    }
    res.json(thinker);
  });

  // Main Chat - Chat with a philosopher (streaming) - USES DATABASE AS SKELETON
  // For outputs > 500 words, uses Cross-Chunk Coherence (CC) system
  app.post("/api/figures/:figureId/chat", async (req: Request, res: Response) => {
    const figureId = req.params.figureId as string;
    
    // Validate request body
    const validation = chatRequestSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: validation.error.issues[0]?.message || "Invalid request" });
    }
    
    const { message, model = "gpt-4o", quoteCount = 20, wordCount = 2000, enhanced = false } = validation.data as any;

    // Set up SSE with proper streaming headers
    setupSSE(res);

    try {
      // Get EXTENSIVE context from database - this is the SKELETON
      const context = await getThinkerContext(figureId, message as string, quoteCount);
      const thinkerName = normalizeThinkerName(figureId);

      // For outputs > 500 words, use Cross-Chunk Coherence system
      if (wordCount > 500) {
        const { processWithCoherence } = await import("./services/coherenceService");
        
        await processWithCoherence({
          sessionType: "chat",
          thinkerId: figureId,
          thinkerName,
          userPrompt: message,
          targetWords: wordCount,
          model: model as any,
          enhanced: enhanced !== false,
          databaseContent: {
            positions: context.positions || [],
            quotes: context.quotes || [],
            arguments: context.arguments || [],
            works: context.works || [],
          },
          res,
        });

        res.write("data: [DONE]\n\n");
        res.end();
        return;
      }

      // For short outputs (< 500 words), use simple single-pass generation
      const systemPrompt = buildPhilosopherSystemPrompt(figureId, context, quoteCount, wordCount, enhanced);

      if (isOpenAIModel(model)) {
        const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
          { role: "system", content: systemPrompt },
          { role: "user", content: message }
        ];

        for await (const chunk of streamOpenAI(messages, model)) {
          sendSSE(res, chunk);
        }
      } else {
        const messages: Array<{ role: "user" | "assistant"; content: string }> = [
          { role: "user", content: message }
        ];

        for await (const chunk of streamAnthropic(systemPrompt, messages, model)) {
          sendSSE(res, chunk);
        }
      }

      res.write("data: [DONE]\n\n");
      res.end();
    } catch (error: any) {
      console.error("Chat error:", error);
      sendSSE(res, `Error: ${error.message}`);
      res.write("data: [DONE]\n\n");
      res.end();
    }
  });

  // Get skeleton (database content) for a thinker - Phase 1 of two-phase generation
  app.post("/api/figures/:figureId/skeleton", async (req: Request, res: Response) => {
    const figureId = req.params.figureId as string;
    const { topic, quoteCount = 20 } = req.body;

    try {
      const context = await getThinkerContext(figureId, topic || "", quoteCount);
      const thinkerName = normalizeThinkerName(figureId);
      
      let skeleton = `=== DATABASE SKELETON FOR ${thinkerName.toUpperCase()} ===\n`;
      skeleton += `Topic: ${topic || "General"}\n`;
      skeleton += `Items fetched: ${quoteCount}\n\n`;

      if (context.positions?.length > 0) {
        skeleton += `--- POSITIONS (${context.positions.length}) ---\n`;
        context.positions.slice(0, quoteCount).forEach((p: any, i: number) => {
          skeleton += `[P${i + 1}] ${p.positionText || p.position_text}\n\n`;
        });
      }

      if (context.quotes?.length > 0) {
        skeleton += `\n--- QUOTES (${context.quotes.length}) ---\n`;
        context.quotes.slice(0, quoteCount).forEach((q: any, i: number) => {
          skeleton += `[Q${i + 1}] "${q.quoteText || q.quote_text}"\n\n`;
        });
      }

      if (context.arguments?.length > 0) {
        skeleton += `\n--- ARGUMENTS (${context.arguments.length}) ---\n`;
        context.arguments.slice(0, Math.floor(quoteCount / 2)).forEach((a: any, i: number) => {
          skeleton += `[A${i + 1}] ${a.argumentText || a.argument_text}\n\n`;
        });
      }

      if (context.works?.length > 0) {
        skeleton += `\n--- WORKS EXCERPTS (${context.works.length}) ---\n`;
        context.works.slice(0, Math.floor(quoteCount / 3)).forEach((w: any, i: number) => {
          const text = (w.workText || w.work_text || '').substring(0, 500);
          skeleton += `[W${i + 1}] ${text}...\n\n`;
        });
      }

      const totalItems = (context.positions?.length || 0) + (context.quotes?.length || 0) + 
                         (context.arguments?.length || 0) + (context.works?.length || 0);
      
      skeleton += `\n=== END SKELETON (${totalItems} total items) ===`;

      res.json({ skeleton, totalItems, thinkerName });
    } catch (error: any) {
      console.error("Skeleton error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Model Builder (streaming)
  app.post("/api/model-builder", async (req: Request, res: Response) => {
    // Validate request body
    const validation = modelBuilderRequestSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: validation.error.issues[0]?.message || "Invalid request" });
    }
    
    const { inputText, mode, model = "gpt-4o" } = validation.data;

    setupSSE(res);

    const systemPrompt = mode === "formal" 
      ? `You are a formal logic expert. Build a formal logical model that makes the given text TRUE. Include:
1. DOMAIN: Define the universe of discourse
2. INTERPRETATION: Define predicates, constants, and functions
3. AXIOMS: List the foundational assumptions
4. THEOREMS: Derive logical consequences

Use first-order logic notation where appropriate.
CRITICAL: DO NOT USE ANY MARKDOWN FORMATTING. No # headers, no * bullets, no - lists, no ** bold. Plain text only with numbered sections.`
      : `You are a philosophical interpreter. Provide an informal conceptual reinterpretation of the given text. Include:
1. KEY CONCEPTS: Identify the main ideas
2. ASSUMPTIONS: What's being taken for granted
3. IMPLICATIONS: What follows from these ideas
4. CONNECTIONS: How this relates to broader philosophical frameworks

CRITICAL: DO NOT USE ANY MARKDOWN FORMATTING. No # headers, no * bullets, no - lists, no ** bold. Plain text only with numbered sections.`;

    try {
      if (isOpenAIModel(model)) {
        const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Build a ${mode} logical model for the following text:\n\n${inputText}` }
        ];

        for await (const chunk of streamOpenAI(messages, model)) {
          sendSSE(res, chunk);
        }
      } else {
        const messages: Array<{ role: "user" | "assistant"; content: string }> = [
          { role: "user", content: `Build a ${mode} logical model for the following text:\n\n${inputText}` }
        ];

        for await (const chunk of streamAnthropic(systemPrompt, messages, model)) {
          sendSSE(res, chunk);
        }
      }

      res.write("data: [DONE]\n\n");
      res.end();
    } catch (error: any) {
      console.error("Model builder error:", error);
      sendSSE(res, `Error: ${error.message}`);
      res.write("data: [DONE]\n\n");
      res.end();
    }
  });

  // Dialogue Generator (streaming) - USES DATABASE AS SKELETON
  app.post("/api/dialogue/generate", async (req: Request, res: Response) => {
    const { topic, thinkers, wordCount = 2000, quoteCount = 20, enhanced = false, model = "gpt-4o" } = req.body;

    if (!topic || !thinkers || thinkers.length < 2) {
      return res.status(400).json({ error: "Topic and at least 2 thinkers are required" });
    }

    setupSSE(res);

    // Get EXTENSIVE context for all thinkers
    const contexts = await Promise.all(
      thinkers.map((t: string) => getThinkerContext(t, topic, Math.floor(quoteCount / thinkers.length)))
    );

    const thinkerNames = thinkers.map((t: string) => normalizeThinkerName(t));

    const effectiveWordCount = wordCount || 3000;

    if (effectiveWordCount > 500) {
      const { processWithCoherence } = await import("./services/coherenceService");
      
      const combinedContent = {
        positions: contexts.flatMap(c => c.positions || []),
        quotes: contexts.flatMap(c => c.quotes || []),
        arguments: contexts.flatMap(c => c.arguments || []),
        works: contexts.flatMap(c => c.works || []),
      };

      const perSpeakerContent: Record<string, { positions: any[]; quotes: any[]; arguments: any[]; works: any[] }> = {};
      thinkerNames.forEach((name: string, idx: number) => {
        perSpeakerContent[name] = {
          positions: contexts[idx]?.positions || [],
          quotes: contexts[idx]?.quotes || [],
          arguments: contexts[idx]?.arguments || [],
          works: contexts[idx]?.works || [],
        };
      });

      await processWithCoherence({
        sessionType: "dialogue",
        thinkerId: thinkers.join("-and-"),
        thinkerName: thinkerNames[0],
        secondSpeaker: thinkerNames[1] || thinkerNames[0],
        allSpeakers: thinkerNames,
        perSpeakerContent,
        userPrompt: `Create a philosophical DIALOGUE on "${topic}" between ${thinkerNames.join(" and ")}. The dialogue must show dialectical progression: each turn introduces new evidence, makes genuine concessions, or synthesizes positions. No repetition allowed.`,
        targetWords: effectiveWordCount,
        model: model as any,
        enhanced: true,
        databaseContent: combinedContent,
        res,
      });

      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }
    
    // Build skeleton for each thinker (short outputs only)
    let allSkeletons = "";
    thinkers.forEach((t: string, i: number) => {
      const ctx = contexts[i];
      const name = thinkerNames[i];
      allSkeletons += buildDatabaseSkeleton(ctx, name, Math.floor(quoteCount / thinkers.length));
    });

    const systemPrompt = `You are creating a philosophical DIALOGUE with speakers taking turns.

=== YOUR ROLE ===
You are the VOICE, not the BRAIN. The database content below IS the brain.
Every substantive claim a thinker makes MUST trace back to a specific item from the database.
You articulate and connect the retrieved material in natural dialogue voice.
You DO NOT generate your own version of what you think these thinkers would say.
You DO NOT substitute generic LLM knowledge about these thinkers.

WORD COUNT TARGET: approximately ${effectiveWordCount} words.

MANDATORY DIALOGUE FORMAT:
- Each speaker's turn MUST start with their name followed by a colon
- Format: "${thinkerNames[0]}: [their statement]" then "${thinkerNames[1]}: [their response]"
- Speakers MUST alternate back and forth throughout the entire dialogue
- Each speaker should have roughly equal speaking time
- Maximum ${thinkerNames.length * 6} total turns (6 per speaker)

=== STRICT DATABASE GROUNDING (ZERO TOLERANCE FOR VIOLATION) ===

RULE 1: Every substantive claim MUST cite a database item [P#], [Q#], [A#], or [W#].
- A "substantive claim" is any assertion about what a thinker believes, argues, or holds.
- Transitional phrases and dialogue mechanics are exempt.
- Generic platitudes that could be attributed to anyone are FORBIDDEN.

RULE 2: The LLM MUST NOT FREELANCE.
- If a thinker has no database positions on a sub-topic, they say so honestly.
- DO NOT fabricate positions the thinker "probably" holds based on training data.
- WRONG: "Freud believed in the unconscious" (generic cliche)
- RIGHT: "I argue that guilt is superego aggression turned inward [P3], as I wrote in Civilization and Its Discontents [W1]"

RULE 3: Each turn selects 1-3 UNUSED database items and builds the argument from them.
- Never cite the same item twice across the entire dialogue.
- After citing an item, it is consumed and cannot be reused.

=== DIALECTICAL PROGRESSION RULES (MANDATORY) ===
EVERY turn MUST satisfy at least ONE of these three conditions. NO EXCEPTIONS:

(a) NEW EVIDENCE: Introduce a position or quote from the database NOT YET CITED.
    The citation must be substantively integrated, not decoratively appended.

(b) GENUINE CONCESSION: Explicitly acknowledge the other speaker's point is correct
    or partially correct AND modify your own position. "I see your point, but..."
    followed by restating the original position does NOT count.

(c) NOVEL SYNTHESIS: Produce a claim combining elements from both speakers'
    positions into something new that neither has said before.

ANTI-REPETITION RULES:
- NEVER restate a position already stated in a prior turn
- NEVER use the same phrasing or argument structure twice
- If you cannot advance the argument, END the dialogue with a synthesis/conclusion
- NO parallel monologues masquerading as dialogue

DO NOT USE ANY MARKDOWN. No # headers, no * bullets, no - lists, no ** bold. Plain text only.

${allSkeletons}

Now write a ${effectiveWordCount}-word dialogue between ${thinkerNames.join(" and ")} on "${topic}".
Every turn must advance the conversation with new evidence, concession, or synthesis.
Every substantive claim must cite a specific database item. NO FREELANCING.`;

    try {
      if (isOpenAIModel(model)) {
        const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Create the ${effectiveWordCount}-word dialogue. Every turn must advance the argument.` }
        ];

        for await (const chunk of streamOpenAI(messages, model)) {
          sendSSE(res, chunk);
        }
      } else {
        const messages: Array<{ role: "user" | "assistant"; content: string }> = [
          { role: "user", content: `Create the ${effectiveWordCount}-word dialogue. Every turn must advance the argument.` }
        ];

        for await (const chunk of streamAnthropic(systemPrompt, messages, model)) {
          sendSSE(res, chunk);
        }
      }

      res.write("data: [DONE]\n\n");
      res.end();
    } catch (error: any) {
      console.error("Dialogue error:", error);
      sendSSE(res, `Error: ${error.message}`);
      res.write("data: [DONE]\n\n");
      res.end();
    }
  });

  // Debate Generator (streaming) - USES DATABASE AS SKELETON
  app.post("/api/debate/generate", async (req: Request, res: Response) => {
    const { topic: rawTopic, debaters, wordCount = 2000, quoteCount = 20, enhanced = false, model = "gpt-4o", debaterDocuments = {} } = req.body;

    if (!rawTopic || !debaters || debaters.length < 2) {
      return res.status(400).json({ error: "Topic and at least 2 debaters are required" });
    }

    setupSSE(res);

    let topic = rawTopic;
    let commonDocument = "";
    if (rawTopic.includes("--- DOCUMENT TO DISCUSS ---")) {
      const parts = rawTopic.split("--- DOCUMENT TO DISCUSS ---");
      topic = parts[0].trim();
      commonDocument = parts[1].trim();
      console.log(`[DEBATE] Extracted common document: ${commonDocument.length} chars, ${commonDocument.split(/\s+/).length} words`);
    }

    const searchTopic = commonDocument 
      ? `${topic} ${commonDocument.substring(0, 500)}`
      : topic;

    const contexts = await Promise.all(
      debaters.map((d: string) => getThinkerContext(d, searchTopic, Math.floor(quoteCount / debaters.length)))
    );

    const debaterNames = debaters.map((d: string) => normalizeThinkerName(d));

    // Process per-debater uploaded documents into positions-like items
    // These get merged into each debater's context so they can cite them as [UD1], [UD2], etc.
    const MAX_DEBATER_DOC_WORDS = 50000;
    const debaterUploadedContent: Record<string, string[]> = {};
    for (let idx = 0; idx < debaters.length; idx++) {
      const debaterId = debaters[idx];
      const docContent = debaterDocuments[debaterId];
      if (docContent && typeof docContent === "string" && docContent.trim().length > 0) {
        // Enforce server-side word limit
        const words = docContent.trim().split(/\s+/).filter(Boolean);
        const limitedText = words.length > MAX_DEBATER_DOC_WORDS
          ? words.slice(0, MAX_DEBATER_DOC_WORDS).join(" ")
          : docContent.trim();
        const chunks = splitUploadedContent(limitedText, 200);
        debaterUploadedContent[debaterNames[idx]] = chunks;
      }
    }

    // For outputs > 500 words, use Cross-Chunk Coherence system
    if (wordCount > 500) {
      const { processWithCoherence } = await import("./services/coherenceService");
      
      // Combine all debaters' content
      const combinedContent = {
        positions: contexts.flatMap(c => c.positions || []),
        quotes: contexts.flatMap(c => c.quotes || []),
        arguments: contexts.flatMap(c => c.arguments || []),
        works: contexts.flatMap(c => c.works || []),
      };

      // Build per-speaker content map so each debater gets their own citations
      const perSpeakerContent: Record<string, { positions: any[]; quotes: any[]; arguments: any[]; works: any[] }> = {};
      debaterNames.forEach((name: string, idx: number) => {
        const uploadedItems = debaterUploadedContent[name] || [];
        perSpeakerContent[name] = {
          positions: [
            ...(contexts[idx].positions || []),
            ...uploadedItems.map((text, i) => ({
              positionText: text,
              position_text: text,
              _uploadedDoc: true,
              _udIndex: i + 1,
            })),
          ],
          quotes: contexts[idx].quotes || [],
          arguments: contexts[idx].arguments || [],
          works: contexts[idx].works || [],
        };
      });

      // Add uploaded content to combined content
      const allUploadedPositions = Object.values(debaterUploadedContent).flat().map((text, i) => ({
        positionText: text,
        position_text: text,
        _uploadedDoc: true,
        _udIndex: i + 1,
      }));
      combinedContent.positions = [...combinedContent.positions, ...allUploadedPositions];

      await processWithCoherence({
        sessionType: "debate",
        thinkerId: debaters.join("-vs-"),
        thinkerName: debaterNames[0],
        secondSpeaker: debaterNames[1] || debaterNames[0],
        allSpeakers: debaterNames,
        perSpeakerContent,
        userPrompt: `Create a DEBATE on "${topic}" between ${debaterNames.join(", ")}.${commonDocument ? " The debaters must discuss the COMMON DOCUMENT provided." : ""}`,
        commonDocument: commonDocument || undefined,
        targetWords: wordCount,
        model: model as any,
        enhanced: true,
        databaseContent: combinedContent,
        res,
      });

      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }
    
    // Build skeleton for each debater (short outputs only)
    let allSkeletons = "";
    debaters.forEach((d: string, i: number) => {
      const ctx = contexts[i];
      const name = debaterNames[i];
      allSkeletons += buildDatabaseSkeleton(ctx, name, Math.floor(quoteCount / debaters.length));

      // Append uploaded document content for this debater
      const uploadedChunks = debaterUploadedContent[name];
      if (uploadedChunks && uploadedChunks.length > 0) {
        allSkeletons += `\n=== ${name.toUpperCase()}'s UPLOADED MATERIAL (cite as [UD1], [UD2], etc.) ===\n`;
        uploadedChunks.forEach((chunk, j) => {
          allSkeletons += `[UD${j + 1}] ${chunk}\n\n`;
        });
      }
    });

    const modeInstruction = enhanced 
      ? "ENHANCED MODE (1:3 RATIO): Database content is the SCAFFOLDING (1 part). LLM elaboration is the FLESH (3 parts). For every database item, add 3x content with historical context, scientific parallels, examples, and illustrations."
      : "STRICT MODE: Use ONLY database content. Explain and elaborate on database items but do not add external content.";

    const speakerList = debaterNames.join(", ");
    const hasUploadedMaterial = Object.keys(debaterUploadedContent).length > 0;
    const citationTypes = hasUploadedMaterial ? "[P#], [Q#], [A#], [W#], [UD#]" : "[P#], [Q#], [A#], [W#]";
    const speakerExample = debaterNames.map((n: string) => `${n}: [Their argument citing ${citationTypes}...]`).join("\n\n");

    const systemPrompt = `You are creating a formal philosophical DEBATE between ${debaterNames.length} speakers: ${speakerList}.

=== YOUR ROLE ===
You are the VOICE, not the BRAIN. The database content below IS the brain.
Every substantive claim must trace to a specific database item or uploaded material.
You DO NOT fabricate what thinkers "probably" think. You DO NOT substitute generic LLM knowledge.

FORMAT REQUIREMENT - THIS IS A DEBATE, NOT AN ESSAY:
ALL ${debaterNames.length} speakers take turns. Format EXACTLY like this:

${speakerExample}

[Continue rotating through ALL speakers]

DEBATE STRUCTURE:
1. OPENING STATEMENTS - EACH of the ${debaterNames.length} debaters presents their position
2. REBUTTALS - Each debater responds to the others' points
3. CROSS-EXAMINATION - Direct questions and answers between debaters
4. CLOSING ARGUMENTS - Each debater summarizes their position

WORD COUNT: At least ${wordCount} words total.

CONTENT RULES:
1. Build from database content below - EACH speaker has their own database items
2. Include at least ${quoteCount} database citations ${citationTypes}
3. ${modeInstruction}
4. Each speaker argues FROM THEIR OWN PERSPECTIVE in first person
5. NO MARKDOWN - plain text only
6. Speakers should DISAGREE and CHALLENGE each other
7. ALL ${debaterNames.length} speakers MUST appear throughout - do NOT skip anyone
8. DO NOT FREELANCE - every substantive claim must cite a database item or uploaded material
${hasUploadedMaterial ? `9. Some debaters have UPLOADED MATERIAL marked with [UD#] codes - these are EXCLUSIVE to that debater and should be cited alongside database items` : ""}

ANTI-REPETITION RULES (HARD CONSTRAINT):
- NO repetition of argumentative content between turns
- If a claim has been made by either debater, it must NOT be restated
- Swapping names, analogies, or examples while making the identical argument COUNTS AS REPETITION
- Each turn must introduce NEW evidence, make a GENUINE CONCESSION, or produce NOVEL SYNTHESIS
- A shorter non-repetitive debate is ALWAYS preferable to a longer repetitive one

MATERIAL USAGE RULES:
- Each debater must EXHAUST their unique database and uploaded material before recycling
- Cite DIFFERENT items in each turn - never re-cite the same [P#], [Q#], [A#], or [UD#]
- If all material has been deployed, conclude the debate rather than padding with repetition

${allSkeletons}
${commonDocument ? `
=== COMMON DOCUMENT TO DISCUSS (ALL SPEAKERS MUST REFERENCE THIS) ===
The debaters have been given this document to discuss. They MUST quote from it, refer to specific passages, and argue about its content directly.

${commonDocument.substring(0, 6000)}
${commonDocument.length > 6000 ? "\n[Document continues - focus on key passages above]" : ""}

=== END COMMON DOCUMENT ===
` : ""}
Write a ${wordCount}-word debate on "${topic}" with ALL ${debaterNames.length} speakers (${speakerList}) taking turns.
Every substantive claim must cite a specific database item or uploaded material.${commonDocument ? " Speakers MUST directly discuss and quote from the COMMON DOCUMENT above." : ""} NO FREELANCING.`;

    try {
      if (isOpenAIModel(model)) {
        const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Create the ${wordCount}-word debate.` }
        ];

        for await (const chunk of streamOpenAI(messages, model)) {
          sendSSE(res, chunk);
        }
      } else {
        const messages: Array<{ role: "user" | "assistant"; content: string }> = [
          { role: "user", content: `Create the ${wordCount}-word debate.` }
        ];

        for await (const chunk of streamAnthropic(systemPrompt, messages, model)) {
          sendSSE(res, chunk);
        }
      }

      res.write("data: [DONE]\n\n");
      res.end();
    } catch (error: any) {
      console.error("Debate error:", error);
      sendSSE(res, `Error: ${error.message}`);
      res.write("data: [DONE]\n\n");
      res.end();
    }
  });

  // Interview Generator (streaming) - USES DATABASE AS SKELETON
  app.post("/api/interview/generate", async (req: Request, res: Response) => {
    const { topic, interviewee, interviewer, wordCount = 2000, quoteCount = 20, enhanced = false, model = "gpt-4o" } = req.body;

    if (!topic || !interviewee) {
      return res.status(400).json({ error: "Topic and interviewee are required" });
    }

    setupSSE(res);

    const context = await getThinkerContext(interviewee, topic, quoteCount);
    const intervieweeName = normalizeThinkerName(interviewee);
    const interviewerName = interviewer ? normalizeThinkerName(interviewer) : "Interviewer";

    // For outputs > 500 words, use Cross-Chunk Coherence system
    if (wordCount > 500) {
      const { processWithCoherence } = await import("./services/coherenceService");
      
      await processWithCoherence({
        sessionType: "interview",
        thinkerId: interviewee,
        thinkerName: intervieweeName,
        secondSpeaker: interviewerName,
        userPrompt: `Create an in-depth INTERVIEW with ${intervieweeName} on "${topic}".`,
        targetWords: wordCount,
        model: model as any,
        enhanced: true,
        databaseContent: {
          positions: context.positions || [],
          quotes: context.quotes || [],
          arguments: context.arguments || [],
          works: context.works || [],
        },
        res,
      });

      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    // Short output path
    const skeleton = buildDatabaseSkeleton(context, intervieweeName, quoteCount);
    
    const systemPrompt = `You are creating an in-depth INTERVIEW with clear Q&A format.

ABSOLUTE WORD COUNT REQUIREMENT - NO EXCEPTIONS:
The interview MUST be AT LEAST ${wordCount} words. This is a MINIMUM, not a target. NEVER write less. NO EXCEPTIONS.

MANDATORY INTERVIEW FORMAT:
- This is a Q&A interview with clear turns between interviewer and interviewee
- Each turn MUST start with the speaker's name followed by a colon
- Format: "${interviewerName}: [question]" then "${intervieweeName}: [answer]"
- The interviewer asks probing questions; the interviewee gives substantive answers
- NOT an essay - it must look like a real interview transcript

EXAMPLE:
${interviewerName}: What is your view on...?
${intervieweeName}: That's an excellent question. I believe...
${interviewerName}: Could you elaborate on...?
${intervieweeName}: Certainly. In my work, I argue...

CRITICAL INSTRUCTIONS:
1. The interview MUST be built from the database content provided below as the SKELETON
2. ${intervieweeName} should quote and reference their actual positions [P#], quotes [Q#], arguments [A#] and works [W#]
3. The interviewer should ask follow-up questions based on the interviewee's answers
4. DO NOT USE ANY MARKDOWN - plain text only

${skeleton}

Now write a ${wordCount}-word interview with ${intervieweeName} on "${topic}". Remember: Q&A format with names and colons!`;

    try {
      if (isOpenAIModel(model)) {
        const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Create the ${wordCount}-word interview.` }
        ];

        for await (const chunk of streamOpenAI(messages, model)) {
          sendSSE(res, chunk);
        }
      } else {
        const messages: Array<{ role: "user" | "assistant"; content: string }> = [
          { role: "user", content: `Create the ${wordCount}-word interview.` }
        ];

        for await (const chunk of streamAnthropic(systemPrompt, messages, model)) {
          sendSSE(res, chunk);
        }
      }

      res.write("data: [DONE]\n\n");
      res.end();
    } catch (error: any) {
      console.error("Interview error:", error);
      sendSSE(res, `Error: ${error.message}`);
      res.write("data: [DONE]\n\n");
      res.end();
    }
  });

  // Quote extraction from text
  app.post("/api/quotes/extract", async (req: Request, res: Response) => {
    const { text } = req.body;

    if (!text) {
      return res.status(400).json({ error: "Text is required" });
    }

    // Simple quote extraction - find text between quotation marks
    const quoteRegex = /"([^"]+)"|"([^"]+)"|«([^»]+)»|'([^']+)'/g;
    const matches: RegExpExecArray[] = [];
    let match: RegExpExecArray | null;
    while ((match = quoteRegex.exec(text)) !== null) {
      matches.push(match);
    }
    const extractedQuotes = matches.map(m => m[1] || m[2] || m[3] || m[4]).filter(Boolean);

    res.json({ quotes: extractedQuotes });
  });

  // File parsing for quotes
  app.post("/api/parse-file", upload.single("file"), async (req: Request, res: Response) => {
    if (!req.file) {
      return res.status(400).json({ error: "File is required" });
    }

    try {
      let text = "";
      const buffer = req.file.buffer;
      const mimeType = req.file.mimetype;
      const fileName = req.file.originalname.toLowerCase();

      if (mimeType === "text/plain" || fileName.endsWith(".txt") || fileName.endsWith(".md")) {
        text = buffer.toString("utf-8");
      } else if (mimeType === "application/pdf" || fileName.endsWith(".pdf")) {
        // For PDF, we'd need pdf-parse but keeping it simple for now
        text = buffer.toString("utf-8");
      } else if (fileName.endsWith(".doc") || fileName.endsWith(".docx")) {
        // For Word docs, using mammoth
        const mammoth = await import("mammoth");
        const result = await mammoth.extractRawText({ buffer });
        text = result.value;
      } else {
        text = buffer.toString("utf-8");
      }

      // Extract quotes
      const quoteRegex = /"([^"]+)"|"([^"]+)"|«([^»]+)»|'([^']+)'/g;
      const matches: RegExpExecArray[] = [];
      let match: RegExpExecArray | null;
      while ((match = quoteRegex.exec(text)) !== null) {
        matches.push(match);
      }
      const extractedQuotes = matches.map(m => m[1] || m[2] || m[3] || m[4]).filter(Boolean);

      res.json({ text, quotes: extractedQuotes });
    } catch (error: any) {
      console.error("File parse error:", error);
      res.status(500).json({ error: "Failed to parse file" });
    }
  });

  // Position generator
  app.post("/api/positions/generate", async (req: Request, res: Response) => {
    const { topic, thinker } = req.body;

    if (!topic || !thinker) {
      return res.status(400).json({ error: "Topic and thinker are required" });
    }

    try {
      const thinkerName = normalizeThinkerName(thinker);
      
      const results = await db
        .select()
        .from(positions)
        .where(
          or(
            ilike(positions.thinker, `%${thinkerName}%`),
            ilike(positions.thinker, `%${thinker}%`)
          )
        )
        .limit(20);

      res.json({ positions: results });
    } catch (error: any) {
      console.error("Position generation error:", error);
      res.status(500).json({ error: "Failed to generate positions" });
    }
  });

  // Argument generator
  app.post("/api/arguments/generate", async (req: Request, res: Response) => {
    const { topic, thinker, argumentType } = req.body;

    if (!topic || !thinker) {
      return res.status(400).json({ error: "Topic and thinker are required" });
    }

    try {
      const context = await getThinkerContext(thinker, topic, 10);
      
      // Generate arguments based on positions
      const args = context.positions.slice(0, 5).map((p: any, i: number) => ({
        premises: [`Based on ${normalizeThinkerName(thinker)}'s philosophy`, p.positionText || p.position_text],
        conclusion: `Therefore, regarding ${topic}...`,
        type: argumentType || "deductive"
      }));

      res.json({ arguments: args });
    } catch (error: any) {
      console.error("Argument generation error:", error);
      res.status(500).json({ error: "Failed to generate arguments" });
    }
  });

  // Outline generator (streaming) - USES DATABASE AS SKELETON
  app.post("/api/outline/generate", async (req: Request, res: Response) => {
    const { topic, thinker, quoteCount = 30, enhanced = false, model = "gpt-4o" } = req.body;

    if (!topic || !thinker) {
      return res.status(400).json({ error: "Topic and thinker are required" });
    }

    setupSSE(res);

    const context = await getThinkerContext(thinker, topic, quoteCount);
    const thinkerName = normalizeThinkerName(thinker);

    const skeleton = buildDatabaseSkeleton(context, thinkerName, quoteCount);
    
    const modeInstruction = enhanced 
      ? "ENHANCED MODE (1:3 RATIO): Database content is the SCAFFOLDING. Suggest additional sections with historical context, scientific parallels, and examples that expand on the database material."
      : "STRICT MODE: The outline must ONLY organize content from the database. Do NOT add topics not covered in the database.";

    const systemPrompt = `You are creating a detailed outline based ENTIRELY on database content.

CRITICAL INSTRUCTIONS:
1. The outline MUST be organized around the database content provided below
2. Each section should reference specific positions [P#], quotes [Q#], arguments [A#] and works [W#]
3. ${modeInstruction}
4. Structure the content logically into sections and subsections
5. Each subsection should list which database items will be covered

${skeleton}

Create a detailed outline for a paper on "${topic}" using the database content.`;

    try {
      if (isOpenAIModel(model)) {
        const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Create a detailed outline that organizes the database content. Reference items by their codes [P1], [Q1], etc.` }
        ];

        for await (const chunk of streamOpenAI(messages, model)) {
          sendSSE(res, chunk);
        }
      } else {
        const messages: Array<{ role: "user" | "assistant"; content: string }> = [
          { role: "user", content: `Create a detailed outline that organizes the database content. Reference items by their codes [P1], [Q1], etc.` }
        ];

        for await (const chunk of streamAnthropic(systemPrompt, messages, model)) {
          sendSSE(res, chunk);
        }
      }

      res.write("data: [DONE]\n\n");
      res.end();
    } catch (error: any) {
      console.error("Outline error:", error);
      sendSSE(res, `Error: ${error.message}`);
      res.write("data: [DONE]\n\n");
      res.end();
    }
  });

  // Full document generator (streaming) - USES DATABASE AS SKELETON
  app.post("/api/document/generate", async (req: Request, res: Response) => {
    const { topic, thinker, wordCount = 5000, quoteCount = 25, enhanced = false, model = "gpt-4o" } = req.body;

    if (!topic || !thinker) {
      return res.status(400).json({ error: "Topic and thinker are required" });
    }

    setupSSE(res);

    const thinkerName = normalizeThinkerName(thinker);
    
    // Fetch EXTENSIVE database content - this is the SKELETON
    const context = await getThinkerContext(thinker, topic, quoteCount);

    // For outputs > 500 words, use Cross-Chunk Coherence system
    if (wordCount > 500) {
      const { processWithCoherence } = await import("./services/coherenceService");
      
      await processWithCoherence({
        sessionType: "document",
        thinkerId: thinker,
        thinkerName,
        userPrompt: `Create a comprehensive philosophical document on "${topic}" based on ${thinkerName}'s actual writings.`,
        targetWords: wordCount,
        model: model as any,
        enhanced: true,
        databaseContent: {
          positions: context.positions || [],
          quotes: context.quotes || [],
          arguments: context.arguments || [],
          works: context.works || [],
        },
        res,
      });

      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    // Short output path
    const skeleton = buildDatabaseSkeleton(context, thinkerName, quoteCount);
    
    const systemPrompt = `You are creating a comprehensive philosophical document based ENTIRELY on ${thinkerName}'s actual writings from the database.

ABSOLUTE WORD COUNT REQUIREMENT - NO EXCEPTIONS:
The document MUST be AT LEAST ${wordCount} words.

CRITICAL INSTRUCTIONS:
1. Your document MUST be built from the database content as the SKELETON
2. Reference specific positions [P#], quotes [Q#], arguments [A#], and works [W#]
3. DO NOT USE ANY MARKDOWN - plain text only.

${skeleton}

Now write a ${wordCount}-word document on "${topic}".`;

    try {
      if (isOpenAIModel(model)) {
        const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Create the ${wordCount}-word document.` }
        ];

        for await (const chunk of streamOpenAI(messages, model)) {
          sendSSE(res, chunk);
        }
      } else {
        const messages: Array<{ role: "user" | "assistant"; content: string }> = [
          { role: "user", content: `Create the ${wordCount}-word document.` }
        ];

        for await (const chunk of streamAnthropic(systemPrompt, messages, model)) {
          sendSSE(res, chunk);
        }
      }

      res.write("data: [DONE]\n\n");
      res.end();
    } catch (error: any) {
      console.error("Document error:", error);
      sendSSE(res, `Error: ${error.message}`);
      res.write("data: [DONE]\n\n");
      res.end();
    }
  });

  // Document Analyzer - Generate CORE document from uploaded text
  app.post("/api/document/analyze", async (req: Request, res: Response) => {
    const { content, author, title, model = "gpt-4o" } = req.body;

    if (!content || !author) {
      return res.status(400).json({ error: "Content and author are required" });
    }

    // Validate content size (max 500KB to prevent abuse)
    const MAX_CONTENT_SIZE = 500 * 1024;
    if (typeof content !== 'string' || content.length > MAX_CONTENT_SIZE) {
      return res.status(400).json({ error: "Content too large. Maximum 500KB allowed." });
    }
    
    // Validate author name
    if (typeof author !== 'string' || author.length > 100 || author.length < 1) {
      return res.status(400).json({ error: "Author name must be 1-100 characters." });
    }

    setupSSE(res);

    const wordCount = content.split(/\s+/).filter((w: string) => w.length > 0).length;
    
    const systemPrompt = `You are a scholarly document analyzer. You will analyze the provided text and extract structured content.

DOCUMENT INFO:
Title: ${title || "Untitled"}
Author: ${author}
Word Count: ${wordCount.toLocaleString()}

OUTPUT FORMAT - Generate in this EXACT order with these EXACT headers:

=== DETAILED OUTLINE ===
[Create a comprehensive outline with main sections and subsections, numbered 1, 1.1, 1.2, 2, 2.1, etc.]

=== KEY POSITIONS ===
[List 10-20 of the most important philosophical/intellectual positions from this text. Each on its own line, starting with "POSITION:"]

=== KEY ARGUMENTS ===
[List 10-20 of the most important arguments made in this text. Each on its own line, starting with "ARGUMENT:"]

=== TRENDS OF THOUGHT ===
[Identify 5-10 general intellectual trends, themes, or patterns in this work. Each on its own line, starting with "TREND:"]

=== QUESTIONS AND ANSWERS ===
[Generate exactly 50 question-answer pairs based on this text. Format each as:]
Q1: [Question that someone might ask the author about this text]
A1: [Answer based on what the author says in this text]

Q2: [Next question]
A2: [Answer based on text]

[Continue through Q50/A50]

CRITICAL RULES:
1. All content must come from the provided text - do not invent
2. Be specific and detailed - cite concepts, terms, claims from the text
3. Questions should cover the full range of topics in the document
4. Answers should be substantive (2-5 sentences each)
5. NO MARKDOWN - plain text only
6. No filler phrases like "This raises profound questions..."`;

    try {
      const userMessage = `Analyze this document and generate the CORE content:\n\n${content.substring(0, 100000)}`;
      
      if (isOpenAIModel(model)) {
        const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage }
        ];

        for await (const chunk of streamOpenAI(messages, model)) {
          sendSSE(res, chunk);
        }
      } else {
        const messages: Array<{ role: "user" | "assistant"; content: string }> = [
          { role: "user", content: userMessage }
        ];

        for await (const chunk of streamAnthropic(systemPrompt, messages, model)) {
          sendSSE(res, chunk);
        }
      }

      res.write("data: [DONE]\n\n");
      res.end();
    } catch (error: any) {
      console.error("Document analysis error:", error);
      sendSSE(res, `Error: ${error.message}`);
      res.write("data: [DONE]\n\n");
      res.end();
    }
  });

  // General AI Chat (streaming)
  app.post("/api/ai/chat", async (req: Request, res: Response) => {
    const { message, model = "gpt-4o", history = [] } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    setupSSE(res);

    const systemPrompt = `You are a helpful AI assistant with expertise in philosophy, logic, and intellectual discourse. Provide thoughtful, well-reasoned responses.
CRITICAL: DO NOT USE ANY MARKDOWN FORMATTING. No # headers, no * bullets, no - lists, no ** bold. Plain text only with numbered sections like 1. 2. 3.`;

    try {
      if (isOpenAIModel(model)) {
        const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
          { role: "system", content: systemPrompt },
          ...history.map((m: any) => ({ role: m.role, content: m.content })),
          { role: "user", content: message }
        ];

        for await (const chunk of streamOpenAI(messages, model)) {
          sendSSE(res, chunk);
        }
      } else {
        const anthropicHistory = history.map((m: any) => ({ role: m.role as "user" | "assistant", content: m.content }));
        anthropicHistory.push({ role: "user" as const, content: message });

        for await (const chunk of streamAnthropic(systemPrompt, anthropicHistory, model)) {
          sendSSE(res, chunk);
        }
      }

      res.write("data: [DONE]\n\n");
      res.end();
    } catch (error: any) {
      console.error("AI Chat error:", error);
      sendSSE(res, `Error: ${error.message}`);
      res.write("data: [DONE]\n\n");
      res.end();
    }
  });

  // Topic population - extract topics from position text format
  app.post("/api/search/populate-topics", async (req: Request, res: Response) => {
    try {
      const { populateTopicsFromPositionText, populateTopicsWithLLM } = await import("./services/searchService");
      const method = req.body?.method || "extract";
      
      if (method === "llm") {
        const batchSize = req.body?.batchSize || 50;
        const result = await populateTopicsWithLLM(batchSize);
        res.json({ success: true, method: "llm", ...result });
      } else {
        const result = await populateTopicsFromPositionText();
        res.json({ success: true, method: "extract", ...result });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Search audit - test the retrieval for a topic and thinker
  app.post("/api/search/audit", async (req: Request, res: Response) => {
    try {
      const { topicFirstRetrieval } = await import("./services/searchService");
      const { thinker, topic, maxResults = 30 } = req.body;
      
      if (!thinker || !topic) {
        return res.status(400).json({ error: "thinker and topic are required" });
      }
      
      const thinkerName = normalizeThinkerName(thinker);
      const result = await topicFirstRetrieval(thinker, thinkerName, topic, maxResults);
      
      res.json({
        audit: result.auditLog,
        positions: result.positions.slice(0, 10).map(p => ({
          id: p.id,
          text: p.text.substring(0, 200),
          relevance: p.relevanceScore,
          topic: p.topic,
        })),
        quotes: result.quotes.slice(0, 5).map(q => ({
          id: q.id,
          text: q.text.substring(0, 200),
          relevance: q.relevanceScore,
        })),
        arguments: result.arguments.slice(0, 5).map(a => ({
          id: a.id,
          text: a.text.substring(0, 200),
          relevance: a.relevanceScore,
        })),
        works: result.works.slice(0, 3).map(w => ({
          id: w.id,
          text: w.text.substring(0, 200),
          relevance: w.relevanceScore,
          source: w.source,
        })),
        totalFound: {
          positions: result.positions.length,
          quotes: result.quotes.length,
          arguments: result.arguments.length,
          works: result.works.length,
          core: result.coreContent.length,
        }
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Ingest API - manually trigger file ingestion
  app.post("/api/ingest", async (_req: Request, res: Response) => {
    try {
      const results = await processIngestFolder();
      res.json({
        success: true,
        message: `Processed ${results.length} files`,
        results
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get ingest status
  app.get("/api/ingest/status", async (_req: Request, res: Response) => {
    const fs = await import("fs");
    const path = await import("path");
    const ingestDir = path.join(process.cwd(), "ingest");
    const processedDir = path.join(process.cwd(), "ingest", "processed");
    
    try {
      const pendingFiles = fs.existsSync(ingestDir) 
        ? fs.readdirSync(ingestDir).filter(f => !f.startsWith(".") && f !== "processed")
        : [];
      const processedFiles = fs.existsSync(processedDir)
        ? fs.readdirSync(processedDir)
        : [];
      
      res.json({
        ingestFolder: ingestDir,
        pendingFiles,
        processedFiles: processedFiles.slice(-20),
        format: "AUTHOR_TYPE_N.txt (e.g., Kuczynski_QUOTES_1.txt)",
        types: ["QUOTES", "POSITIONS", "ARGUMENTS", "WORKS"]
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return httpServer;
}
