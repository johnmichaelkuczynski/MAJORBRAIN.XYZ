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
  model: string = "claude-3-5-sonnet-20241022"
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
  
  return query
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.has(word))
    .slice(0, 10); // Max 10 keywords
}

// SEMANTIC SEARCH: Find content that matches the user's query topic
async function getThinkerContext(thinkerId: string, query: string, quoteCount: number = 50) {
  const thinkerName = normalizeThinkerName(thinkerId);
  const searchTerms = extractSearchTerms(query);
  
  console.log(`[SEARCH] Query: "${query}"`);
  console.log(`[SEARCH] Extracted terms: ${searchTerms.join(', ')}`);
  console.log(`[SEARCH] Thinker: ${thinkerName}`);

  // Build search conditions for each content type
  // Priority 1: Content that matches query terms (RELEVANT to the question)
  // Priority 2: Any content by this thinker (fallback)
  
  const buildSearchConditions = (textColumn: any, thinkerColumn: any) => {
    const thinkerMatch = or(
      ilike(thinkerColumn, `%${thinkerName}%`),
      ilike(thinkerColumn, `%${thinkerId}%`)
    );
    
    if (searchTerms.length === 0) {
      return thinkerMatch;
    }
    
    // Search for ANY of the query terms in the content
    const termMatches = searchTerms.map(term => ilike(textColumn, `%${term}%`));
    return sql`${thinkerMatch} AND (${sql.join(termMatches, sql` OR `)})`;
  };

  // STEP 1: Search for content RELEVANT to the query
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

  console.log(`[SEARCH] Found relevant: ${relevantPositions.length} positions, ${relevantQuotes.length} quotes, ${relevantArguments.length} arguments, ${relevantWorks.length} works`);

  // STEP 2: If no relevant content found, fall back to general content (but warn)
  if (relevantPositions.length === 0 && relevantQuotes.length === 0 && 
      relevantArguments.length === 0 && relevantWorks.length === 0) {
    console.log(`[SEARCH] No relevant content found for query. Using general content as fallback.`);
    
    relevantPositions = await safeDbQuery(
      () => db
        .select()
        .from(positions)
        .where(or(
          ilike(positions.thinker, `%${thinkerName}%`),
          ilike(positions.thinker, `%${thinkerId}%`)
        ))
        .limit(Math.floor(quoteCount / 2)),
      []
    );

    relevantQuotes = await safeDbQuery(
      () => db
        .select()
        .from(quotes)
        .where(or(
          ilike(quotes.thinker, `%${thinkerName}%`),
          ilike(quotes.thinker, `%${thinkerId}%`)
        ))
        .limit(Math.floor(quoteCount / 2)),
      []
    );

    relevantArguments = await safeDbQuery(
      () => db
        .select()
        .from(arguments_)
        .where(or(
          ilike(arguments_.thinker, `%${thinkerName}%`),
          ilike(arguments_.thinker, `%${thinkerId}%`)
        ))
        .limit(Math.floor(quoteCount / 4)),
      []
    );

    relevantWorks = await safeDbQuery(
      () => db
        .select()
        .from(works)
        .where(or(
          ilike(works.thinker, `%${thinkerName}%`),
          ilike(works.thinker, `%${thinkerId}%`)
        ))
        .limit(Math.floor(quoteCount / 4)),
      []
    );
    
    console.log(`[SEARCH] Fallback found: ${relevantPositions.length} positions, ${relevantQuotes.length} quotes`);
  }

  return {
    positions: relevantPositions,
    quotes: relevantQuotes,
    arguments: relevantArguments,
    works: relevantWorks,
    textChunks: [],
    searchTerms,
    queryWasMatched: relevantPositions.length > 0 || relevantQuotes.length > 0 || relevantArguments.length > 0 || relevantWorks.length > 0,
  };
}

// Build a SKELETON from database content that the AI MUST use
function buildDatabaseSkeleton(context: any, thinkerName: string, quoteCount: number): string {
  let skeleton = `\n\n=== MANDATORY DATABASE CONTENT - YOU MUST USE THIS AS YOUR SKELETON ===\n`;
  skeleton += `The following content is from ${thinkerName}'s actual writings in the database.\n`;
  skeleton += `You MUST incorporate AT LEAST ${quoteCount} of these items into your response.\n`;
  skeleton += `DO NOT make up positions or quotes - use ONLY what is provided below.\n`;
  skeleton += `CRITICAL: DO NOT USE ANY MARKDOWN FORMATTING. No #, no *, no -, no **. Plain text only.\n\n`;
  
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
  skeleton += `\nREMINDER: Your output MUST be built from the above content. Reference items by their codes [P1], [Q1], [A1], [W1] etc. DO NOT invent content.\n`;
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
- ANY vague philosophical-sounding filler

NEVER:
- Speak in third person about yourself
- Use LLM puffery or filler phrases
- Ramble without substance
- Use markdown formatting (no #, *, -, **)
- Make up positions not in the database

=== YOUR ACTUAL CONTENT ===

${queryWasMatched ? "The database content below DIRECTLY answers the user's question. USE IT." : "NOTE: No content directly matching this query was found. State that you would need to consult your writings on this specific topic, but you can offer related thoughts from your general positions."}

${context.positions?.length > 0 ? `\n--- MY POSITIONS ---\n${context.positions.slice(0, quoteCount).map((p: any, i: number) => `[P${i + 1}] ${p.positionText || p.position_text}`).join('\n')}` : ''}

${context.quotes?.length > 0 ? `\n--- MY QUOTES ---\n${context.quotes.slice(0, quoteCount).map((q: any, i: number) => `[Q${i + 1}] "${q.quoteText || q.quote_text}"`).join('\n')}` : ''}

${context.arguments?.length > 0 ? `\n--- MY ARGUMENTS ---\n${context.arguments.slice(0, Math.floor(quoteCount / 2)).map((a: any, i: number) => `[A${i + 1}] ${a.argumentText || a.argument_text}`).join('\n')}` : ''}

${context.works?.length > 0 ? `\n--- MY WORKS ---\n${context.works.slice(0, Math.floor(quoteCount / 3)).map((w: any, i: number) => `[W${i + 1}] ${(w.workText || w.work_text || '').substring(0, 500)}...`).join('\n')}` : ''}

=== HOW TO RESPOND ===

1. Answer the question DIRECTLY using the database content above
2. Cite sources with [P1], [Q1], [A1], [W1] codes
3. Speak as yourself in first person: "I believe...", "My argument is...", "I reject..."
4. Be direct and substantive - no filler
5. ${enhanced ? "ENHANCED: Use database as scaffolding (1 part), add your elaboration (3 parts) with examples, history, applications" : "STRICT: Stay close to database content"}
6. Write at least ${wordCount} words of SUBSTANCE

Database contains ${totalDbContent} items. Cite them with [P#], [Q#], [A#], [W#] codes.

BEGIN YOUR RESPONSE IN FIRST PERSON. NO PREAMBLE.`;

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

    // For outputs > 500 words, use Cross-Chunk Coherence system
    if (wordCount > 500) {
      const { processWithCoherence } = await import("./services/coherenceService");
      
      // Combine all thinkers' content
      const combinedContent = {
        positions: contexts.flatMap(c => c.positions || []),
        quotes: contexts.flatMap(c => c.quotes || []),
        arguments: contexts.flatMap(c => c.arguments || []),
        works: contexts.flatMap(c => c.works || []),
      };

      await processWithCoherence({
        sessionType: "dialogue",
        thinkerId: thinkers.join("-and-"),
        thinkerName: thinkerNames.join(" and "),
        userPrompt: `Create a philosophical DIALOGUE on "${topic}" between ${thinkerNames.join(" and ")}.

MANDATORY DIALOGUE FORMAT:
- Each speaker's turn MUST start with their name followed by a colon
- Format: "${thinkerNames[0]}: [their statement]" then "${thinkerNames[1]}: [their response]"
- Speakers MUST alternate back and forth throughout the entire dialogue
- This is a CONVERSATION with turn-taking, NOT an essay or monologue
- Each speaker should have roughly equal speaking time

EXAMPLE:
${thinkerNames[0]}: I believe that...
${thinkerNames[1]}: That is interesting, but I argue...
${thinkerNames[0]}: You raise a concern. However...

Speakers should ENGAGE with each other's points and respond directly to what the other says.`,
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
    
    // Build skeleton for each thinker (short outputs only)
    let allSkeletons = "";
    thinkers.forEach((t: string, i: number) => {
      const ctx = contexts[i];
      const name = thinkerNames[i];
      allSkeletons += buildDatabaseSkeleton(ctx, name, Math.floor(quoteCount / thinkers.length));
    });

    const systemPrompt = `You are creating a philosophical DIALOGUE with speakers taking turns.

ABSOLUTE WORD COUNT REQUIREMENT - NO EXCEPTIONS:
The dialogue MUST be AT LEAST ${wordCount} words.

MANDATORY DIALOGUE FORMAT:
- Each speaker's turn MUST start with their name followed by a colon
- Format: "${thinkerNames[0]}: [their statement]" then "${thinkerNames[1]}: [their response]"
- Speakers MUST alternate back and forth throughout the entire dialogue
- This is a CONVERSATION, NOT an essay or monologue
- Each speaker should have roughly equal speaking time

EXAMPLE FORMAT:
${thinkerNames[0]}: I believe that...
${thinkerNames[1]}: That is an interesting point, but I would argue...
${thinkerNames[0]}: You raise a valid concern. However...
${thinkerNames[1]}: Let me respond to that by saying...

CRITICAL INSTRUCTIONS:
1. Each thinker should quote and reference their actual positions [P#], quotes [Q#], arguments [A#] and works [W#]
2. DO NOT USE ANY MARKDOWN - plain text only
3. The dialogue should feel like a real philosophical conversation
4. Speakers should ENGAGE with each other's points, not just deliver separate speeches

${allSkeletons}

Now write a ${wordCount}-word dialogue between ${thinkerNames.join(" and ")} on "${topic}". Remember: speaker names with colons, alternating turns!`;

    try {
      if (isOpenAIModel(model)) {
        const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Create the ${wordCount}-word dialogue.` }
        ];

        for await (const chunk of streamOpenAI(messages, model)) {
          sendSSE(res, chunk);
        }
      } else {
        const messages: Array<{ role: "user" | "assistant"; content: string }> = [
          { role: "user", content: `Create the ${wordCount}-word dialogue.` }
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
    const { topic, debaters, wordCount = 2000, quoteCount = 20, enhanced = false, model = "gpt-4o" } = req.body;

    if (!topic || !debaters || debaters.length < 2) {
      return res.status(400).json({ error: "Topic and at least 2 debaters are required" });
    }

    setupSSE(res);

    const contexts = await Promise.all(
      debaters.map((d: string) => getThinkerContext(d, topic, Math.floor(quoteCount / debaters.length)))
    );

    const debaterNames = debaters.map((d: string) => normalizeThinkerName(d));

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

      await processWithCoherence({
        sessionType: "debate",
        thinkerId: debaters.join("-vs-"),
        thinkerName: debaterNames.join(" vs "),
        userPrompt: `Create a DEBATE (back-and-forth exchange) on "${topic}" between ${debaterNames.join(" and ")}. 
        
FORMAT: Each speaker takes turns like this:
${debaterNames[0]}: [speaks...]
${debaterNames[1]}: [responds...]
${debaterNames[0]}: [rebuts...]

STRUCTURE: Opening Statements, Rebuttals, Cross-Examination, Closing Arguments. Speakers must DISAGREE and CHALLENGE each other.`,
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
    });

    const modeInstruction = enhanced 
      ? "ENHANCED MODE (1:3 RATIO): Database content is the SCAFFOLDING (1 part). LLM elaboration is the FLESH (3 parts). For every database item, add 3x content with historical context, scientific parallels, examples, and illustrations."
      : "STRICT MODE: Use ONLY database content. Explain and elaborate on database items but do not add external content.";

    const systemPrompt = `You are creating a formal philosophical DEBATE - a back-and-forth exchange between speakers.

FORMAT REQUIREMENT - THIS IS A DEBATE, NOT AN ESSAY:
Each speaker takes turns. Format EXACTLY like this:

${debaterNames[0]}: [Their opening statement...]

${debaterNames[1]}: [Their response...]

${debaterNames[0]}: [Their rebuttal...]

${debaterNames[1]}: [Their counter-argument...]

[Continue alternating speakers throughout]

DEBATE STRUCTURE:
1. OPENING STATEMENTS - Each debater presents their position (2-3 paragraphs each)
2. REBUTTALS - Each debater responds to the other's points (2-3 exchanges)
3. CROSS-EXAMINATION - Direct questions and answers between debaters (3-4 exchanges)
4. CLOSING ARGUMENTS - Each debater summarizes their position (1-2 paragraphs each)

WORD COUNT: At least ${wordCount} words total.

CONTENT RULES:
1. Build from database content below
2. Include at least ${quoteCount} database citations [P#], [Q#], [A#], [W#]
3. ${modeInstruction}
4. Each speaker argues FROM THEIR OWN PERSPECTIVE in first person
5. NO MARKDOWN - plain text only
6. Speakers should DISAGREE and CHALLENGE each other

${allSkeletons}

Write a ${wordCount}-word debate on "${topic}" with ${debaterNames.join(" and ")} taking turns speaking.`;

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
        userPrompt: `Create an in-depth interview with ${intervieweeName} on "${topic}". The interviewer is ${interviewerName}. Format: Q&A with probing follow-up questions.`,
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
    
    const systemPrompt = `You are creating an in-depth interview based ENTIRELY on database content.

ABSOLUTE WORD COUNT REQUIREMENT - NO EXCEPTIONS:
The interview MUST be AT LEAST ${wordCount} words. This is a MINIMUM, not a target. NEVER write less. NO EXCEPTIONS.

CRITICAL INSTRUCTIONS:
1. The interview MUST be built from the database content provided below as the SKELETON
2. ${intervieweeName} should quote and reference their actual positions [P#], quotes [Q#], arguments [A#] and works [W#]
3. The interviewer is ${interviewerName}
4. DO NOT USE ANY MARKDOWN - plain text only.

${skeleton}

Now write a ${wordCount}-word interview with ${intervieweeName} on "${topic}".`;

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
