import { Response } from "express";
import { generateText, streamText, countWords, delay, CHUNK_DELAY_MS, ModelId } from "./aiProviderService";
import { db } from "../db";
import { coherenceSessions, coherenceChunks, stitchResults } from "@shared/schema";
import { eq } from "drizzle-orm";

export interface GlobalSkeleton {
  thesis: string;
  outline: string[];
  keyTerms: Record<string, string>;
  commitments: string[];
  entities: string[];
  databaseContent: {
    positions: string[];
    quotes: string[];
    arguments: string[];
    works: string[];
  };
}

export interface ChunkDelta {
  claimsAdded: string[];
  termsUsed: string[];
  conflictsDetected: string[];
  continuityNotes: string;
}

export interface CoherenceOptions {
  sessionType: "chat" | "debate" | "interview" | "dialogue" | "document";
  thinkerId: string;
  thinkerName: string;
  userPrompt: string;
  targetWords: number;
  model: ModelId;
  enhanced: boolean;
  databaseContent: {
    positions: any[];
    quotes: any[];
    arguments: any[];
    works: any[];
  };
  res: Response;
}

function sendSSE(res: Response, data: string) {
  // Send in format expected by streamResponseSimple: { content: "word" }
  res.write(`data: ${JSON.stringify({ content: data })}\n\n`);
  if (typeof (res as any).flush === "function") {
    (res as any).flush();
  }
}

async function streamTokensVisibly(res: Response, text: string, delayMs: number = 10) {
  const words = text.split(/(\s+)/);
  for (const word of words) {
    if (word) {
      sendSSE(res, word);
      if (delayMs > 0) {
        await delay(delayMs);
      }
    }
  }
}

async function createSession(options: CoherenceOptions): Promise<string> {
  const result = await db.insert(coherenceSessions).values({
    sessionType: options.sessionType,
    thinkerId: options.thinkerId,
    userPrompt: options.userPrompt,
    targetWords: options.targetWords,
    status: "pending",
  }).returning({ id: coherenceSessions.id });
  
  return result[0].id;
}

async function updateSessionSkeleton(sessionId: string, skeleton: GlobalSkeleton, totalChunks: number): Promise<void> {
  await db.update(coherenceSessions)
    .set({ 
      globalSkeleton: skeleton as any,
      totalChunks,
      status: "skeleton",
    })
    .where(eq(coherenceSessions.id, sessionId));
}

async function getSessionSkeleton(sessionId: string): Promise<GlobalSkeleton | null> {
  const result = await db.select({ globalSkeleton: coherenceSessions.globalSkeleton })
    .from(coherenceSessions)
    .where(eq(coherenceSessions.id, sessionId));
  
  if (result.length > 0 && result[0].globalSkeleton) {
    return result[0].globalSkeleton as unknown as GlobalSkeleton;
  }
  return null;
}

async function saveChunk(sessionId: string, chunkIndex: number, output: string, delta: ChunkDelta, wordCount: number): Promise<void> {
  await db.insert(coherenceChunks).values({
    sessionId,
    chunkIndex,
    chunkOutput: output,
    chunkDelta: delta as any,
    wordCount,
    status: "complete",
    processedAt: new Date(),
  });
  
  await db.update(coherenceSessions)
    .set({ 
      currentChunk: chunkIndex + 1,
      status: "chunking",
    })
    .where(eq(coherenceSessions.id, sessionId));
}

async function getPriorDeltas(sessionId: string): Promise<ChunkDelta[]> {
  const result = await db.select({ chunkDelta: coherenceChunks.chunkDelta })
    .from(coherenceChunks)
    .where(eq(coherenceChunks.sessionId, sessionId));
  
  return result
    .map(r => r.chunkDelta as unknown as ChunkDelta)
    .filter(Boolean);
}

async function saveStitchResult(sessionId: string, totalWords: number, conflicts: string[]): Promise<void> {
  await db.insert(stitchResults).values({
    sessionId,
    conflicts: conflicts as any,
    repairs: [] as any,
    coherenceScore: conflicts.length === 0 ? "pass" : "needs_repair",
  });
  
  await db.update(coherenceSessions)
    .set({ 
      actualWords: totalWords,
      status: "complete",
    })
    .where(eq(coherenceSessions.id, sessionId));
}

export async function extractGlobalSkeleton(
  userPrompt: string,
  thinkerName: string,
  databaseContent: CoherenceOptions["databaseContent"],
  model: ModelId
): Promise<GlobalSkeleton> {
  const positionTexts = databaseContent.positions.slice(0, 20).map((p: any, i: number) => 
    `[P${i + 1}] ${p.positionText || p.position_text}`
  );
  const quoteTexts = databaseContent.quotes.slice(0, 20).map((q: any, i: number) => 
    `[Q${i + 1}] "${q.quoteText || q.quote_text}"`
  );
  const argumentTexts = databaseContent.arguments.slice(0, 10).map((a: any, i: number) => 
    `[A${i + 1}] ${a.argumentText || a.argument_text}`
  );
  const workTexts = databaseContent.works.slice(0, 5).map((w: any, i: number) => 
    `[W${i + 1}] ${(w.workText || w.work_text || '').substring(0, 500)}...`
  );

  const systemPrompt = `You are a skeleton extractor. Extract the structural DNA of this request.
Return ONLY valid JSON with this exact structure:
{
  "thesis": "The central claim or purpose (one sentence)",
  "outline": ["Section 1 topic", "Section 2 topic", ...],
  "keyTerms": {"term1": "definition1", "term2": "definition2"},
  "commitments": ["${thinkerName} asserts X", "${thinkerName} rejects Y"],
  "entities": ["concept1", "concept2"]
}`;

  const userContent = `Extract skeleton for a ${thinkerName} response to: "${userPrompt}"

DATABASE CONTENT TO USE:
${positionTexts.join("\n")}
${quoteTexts.join("\n")}
${argumentTexts.join("\n")}
${workTexts.join("\n")}

Return ONLY the JSON skeleton.`;

  try {
    const response = await generateText({
      model,
      systemPrompt,
      userPrompt: userContent,
      maxTokens: 2000,
      temperature: 0.3,
    });

    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        thesis: parsed.thesis || "",
        outline: parsed.outline || [],
        keyTerms: parsed.keyTerms || {},
        commitments: parsed.commitments || [],
        entities: parsed.entities || [],
        databaseContent: {
          positions: positionTexts,
          quotes: quoteTexts,
          arguments: argumentTexts,
          works: workTexts,
        },
      };
    }
  } catch (error) {
    console.error("Skeleton extraction error:", error);
  }

  return {
    thesis: userPrompt,
    outline: ["Introduction", "Main Analysis", "Conclusion"],
    keyTerms: {},
    commitments: [],
    entities: [],
    databaseContent: {
      positions: positionTexts,
      quotes: quoteTexts,
      arguments: argumentTexts,
      works: workTexts,
    },
  };
}

function buildChunkPrompt(
  skeleton: GlobalSkeleton,
  chunkIndex: number,
  totalChunks: number,
  targetWordsPerChunk: number,
  thinkerName: string,
  priorDeltas: ChunkDelta[],
  enhanced: boolean = true
): { system: string; user: string } {
  const priorClaimsStr = priorDeltas.flatMap(d => d.claimsAdded || []).join("; ");
  const minWords = Math.ceil(targetWordsPerChunk * 1.2);
  
  // CORE REQUIREMENTS - same for both modes
  const coreRules = `
=== ABSOLUTE REQUIREMENTS ===

FIRST PERSON ONLY - NO EXCEPTIONS:
- Say "I believe", "My view is", "I argue", "In my work"
- NEVER say "${thinkerName} argues" or "${thinkerName}'s view"
- NEVER refer to yourself in third person. EVER.

FORBIDDEN PHRASES - ZERO TOLERANCE:
- "This raises profound questions..."
- "And so we see that..."
- "It is important to note..."
- "In this context, we must consider..."
- "This brings us to a broader point..."
- "Let me explain..."
- "The implications of this are..."
- "This leads us to consider..."
- "One might argue..."
- "I have long held that..."
- "I have long believed..."
- "It is my view that..."
- "It has always been my position..."
- "Throughout my career..."
- "fostering innovation and understanding"
- ANY vague philosophical-sounding filler
- ANY autobiographical padding

STYLE:
- Be DIRECT and CONCISE - answer IMMEDIATELY
- Get to the point in the FIRST sentence
- State positions clearly without preamble
- No padding, no throat-clearing, no rambling
- Start with the actual answer, not with setup
- No markdown (no #, *, -, **)

WORD COUNT: AT LEAST ${minWords} words of SUBSTANCE.`;

  let system: string;
  
  if (enhanced) {
    system = `You ARE ${thinkerName}. Speak in FIRST PERSON.
${coreRules}

=== DATABASE CONTENT (Your actual positions - USE THESE) ===
${skeleton.databaseContent.positions.slice(0, 8).join("\n")}
${skeleton.databaseContent.quotes.slice(0, 6).join("\n")}
${skeleton.databaseContent.arguments.slice(0, 4).join("\n")}

THESIS: ${skeleton.thesis}
COMMITMENTS: ${skeleton.commitments.join("; ")}

${priorClaimsStr ? `PRIOR CLAIMS MADE: ${priorClaimsStr}` : ""}

=== ENHANCED MODE (1:3 RATIO) ===
- 1 part: Database content (cite with [P#], [Q#], [A#], [W#])
- 3 parts: Your elaboration with examples, history, applications
- Always speak as "I" - never third person`;
  } else {
    system = `You ARE ${thinkerName}. Speak in FIRST PERSON.
${coreRules}

=== DATABASE CONTENT (Your actual positions) ===
${skeleton.databaseContent.positions.slice(0, 10).join("\n")}
${skeleton.databaseContent.quotes.slice(0, 10).join("\n")}
${skeleton.databaseContent.arguments.slice(0, 5).join("\n")}

THESIS: ${skeleton.thesis}
COMMITMENTS: ${skeleton.commitments.join("; ")}
KEY TERMS: ${Object.entries(skeleton.keyTerms).map(([k, v]) => `${k}: ${v}`).join("; ")}

${priorClaimsStr ? `PRIOR CLAIMS MADE: ${priorClaimsStr}` : ""}

=== STRICT MODE ===
- Cite database content with [P#], [Q#], [A#], [W#]
- Stay close to what is in the database
- Speak in FIRST PERSON as yourself`;
  }

  const outlineSection = skeleton.outline[chunkIndex] || `Part ${chunkIndex + 1}`;
  
  const user = `Section: "${outlineSection}"

Write ${minWords}+ words. First person. Direct. No filler. Cite sources [P#], [Q#], [A#], [W#].

BEGIN NOW.`;

  return { system, user };
}

function extractDeltaFromOutput(output: string, skeleton: GlobalSkeleton): ChunkDelta {
  const claimsAdded: string[] = [];
  const termsUsed: string[] = [];
  const conflictsDetected: string[] = [];

  const sentences = output.split(/[.!?]+/).filter(s => s.trim().length > 20);
  sentences.slice(0, 5).forEach(s => {
    if (s.includes("assert") || s.includes("claim") || s.includes("argue") || s.includes("position")) {
      claimsAdded.push(s.trim().substring(0, 100));
    }
  });

  Object.keys(skeleton.keyTerms).forEach(term => {
    if (output.toLowerCase().includes(term.toLowerCase())) {
      termsUsed.push(term);
    }
  });

  skeleton.commitments.forEach(commitment => {
    const negation = commitment.replace("asserts", "rejects").replace("rejects", "asserts");
    if (output.includes(negation.substring(0, 30))) {
      conflictsDetected.push(`Potential contradiction with commitment: ${commitment}`);
    }
  });

  return {
    claimsAdded,
    termsUsed,
    conflictsDetected,
    continuityNotes: `Chunk produced ${countWords(output)} words`,
  };
}

// Send skeleton data to a separate channel (prefixed for frontend parsing)
function sendSkeletonSSE(res: Response, data: string) {
  res.write(`data: ${JSON.stringify({ type: "skeleton", content: data })}\n\n`);
  if (typeof (res as any).flush === "function") {
    (res as any).flush();
  }
}

// Send content data (the actual response - NO metadata)
function sendContentSSE(res: Response, data: string) {
  res.write(`data: ${JSON.stringify({ type: "content", content: data })}\n\n`);
  if (typeof (res as any).flush === "function") {
    (res as any).flush();
  }
}

export async function processWithCoherence(options: CoherenceOptions): Promise<void> {
  const { sessionType, thinkerId, thinkerName, userPrompt, targetWords, model, enhanced, databaseContent, res } = options;

  const WORDS_PER_CHUNK = 1000;
  const totalChunks = Math.max(1, Math.ceil(targetWords / WORDS_PER_CHUNK));
  const wordsPerChunk = Math.ceil(targetWords / totalChunks);

  // SKELETON PHASE - sent to skeleton popup only
  sendSkeletonSSE(res, `Building skeleton from database...\n`);
  sendSkeletonSSE(res, `Target: ${targetWords.toLocaleString()} words\n\n`);

  const sessionId = await createSession(options);

  const skeleton = await extractGlobalSkeleton(userPrompt, thinkerName, databaseContent, model);
  await updateSessionSkeleton(sessionId, skeleton, totalChunks);

  // Stream clean skeleton to skeleton popup
  sendSkeletonSSE(res, `THESIS\n${skeleton.thesis}\n\n`);
  
  sendSkeletonSSE(res, `OUTLINE\n`);
  skeleton.outline.forEach((section, i) => {
    sendSkeletonSSE(res, `${i + 1}. ${section}\n`);
  });
  
  if (skeleton.commitments.length > 0) {
    sendSkeletonSSE(res, `\nCOMMITMENTS\n`);
    skeleton.commitments.forEach((c, i) => {
      sendSkeletonSSE(res, `${i + 1}. ${c}\n`);
    });
  }
  
  if (Object.keys(skeleton.keyTerms).length > 0) {
    sendSkeletonSSE(res, `\nKEY TERMS\n`);
    Object.entries(skeleton.keyTerms).forEach(([term, def]) => {
      sendSkeletonSSE(res, `${term}: ${def}\n`);
    });
  }
  
  sendSkeletonSSE(res, `\nDATABASE ITEMS FOUND\n`);
  sendSkeletonSSE(res, `Positions: ${skeleton.databaseContent.positions.length}\n`);
  sendSkeletonSSE(res, `Quotes: ${skeleton.databaseContent.quotes.length}\n`);
  sendSkeletonSSE(res, `Arguments: ${skeleton.databaseContent.arguments.length}\n`);
  sendSkeletonSSE(res, `Works: ${skeleton.databaseContent.works.length}\n`);
  
  sendSkeletonSSE(res, `\n[SKELETON_COMPLETE]\n`);

  await delay(500);

  // CONTENT PHASE - only actual content goes to main popup (NO METADATA)
  let totalOutput = "";
  let totalWordCount = 0;

  for (let i = 0; i < totalChunks; i++) {
    const dbSkeleton = await getSessionSkeleton(sessionId);
    if (!dbSkeleton) {
      console.error("Could not retrieve skeleton from database");
      return;
    }

    const priorDeltas = await getPriorDeltas(sessionId);
    const { system, user } = buildChunkPrompt(dbSkeleton, i, totalChunks, wordsPerChunk, thinkerName, priorDeltas, enhanced);

    let chunkOutput = "";
    for await (const text of streamText({ model, systemPrompt: system, userPrompt: user, maxTokens: 4096 })) {
      chunkOutput += text;
      // Stream ONLY content to user - no metadata
      sendContentSSE(res, text);
    }

    const chunkWords = countWords(chunkOutput);
    totalOutput += chunkOutput + "\n\n";
    totalWordCount += chunkWords;

    const delta = extractDeltaFromOutput(chunkOutput, dbSkeleton);
    await saveChunk(sessionId, i, chunkOutput, delta, chunkWords);

    // Log progress to console only, NOT to user
    console.log(`[COHERENCE] Chunk ${i + 1}/${totalChunks}: ${chunkWords} words | Total: ${totalWordCount}/${targetWords}`);

    if (i < totalChunks - 1) {
      // Add paragraph break between chunks, pause for rate limit
      sendContentSSE(res, "\n\n");
      await delay(CHUNK_DELAY_MS);
    }
  }

  // Check if we need more content
  if (totalWordCount < targetWords * 0.9) {
    const shortfall = targetWords - totalWordCount;
    console.log(`[COHERENCE] Shortfall: ${shortfall} words. Generating supplement...`);
    
    const dbSkeleton = await getSessionSkeleton(sessionId);
    if (dbSkeleton) {
      const supplementPrompt = buildChunkPrompt(dbSkeleton, totalChunks, totalChunks + 1, shortfall, thinkerName, await getPriorDeltas(sessionId), enhanced);
      let supplementOutput = "";
      
      sendContentSSE(res, "\n\n");
      for await (const text of streamText({ model, systemPrompt: supplementPrompt.system, userPrompt: supplementPrompt.user, maxTokens: 4096 })) {
        supplementOutput += text;
        sendContentSSE(res, text);
      }
      totalOutput += supplementOutput;
      totalWordCount = countWords(totalOutput);
      
      const delta = extractDeltaFromOutput(supplementOutput, dbSkeleton);
      await saveChunk(sessionId, totalChunks, supplementOutput, delta, countWords(supplementOutput));
    }
  }

  const allDeltas = await getPriorDeltas(sessionId);
  const allConflicts = allDeltas.flatMap(d => d.conflictsDetected || []);
  await saveStitchResult(sessionId, totalWordCount, allConflicts);

  // Log completion to console only
  console.log(`[COHERENCE] Complete: ${totalWordCount} words | Session: ${sessionId} | Conflicts: ${allConflicts.length}`);
}
