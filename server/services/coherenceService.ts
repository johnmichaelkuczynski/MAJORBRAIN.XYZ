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
  res.write(`data: ${JSON.stringify(data)}\n\n`);
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
  const priorTermsStr = priorDeltas.flatMap(d => d.termsUsed || []).join(", ");
  
  // Enhanced mode: 1 part database scaffolding, 3 parts creative elaboration
  // Standard mode: Strict database regurgitation with citations
  
  const minWords = Math.ceil(targetWordsPerChunk * 1.2); // 20% buffer to ensure target is met
  
  let system: string;
  
  if (enhanced) {
    system = `You are ${thinkerName}, a profound thinker writing an extended philosophical essay. This is ENHANCED MODE.

CRITICAL WORD COUNT: You MUST write AT LEAST ${minWords} words. This is NON-NEGOTIABLE. Count as you write. If unsure, write MORE.

THE 1:3 RATIO (ENHANCED MODE):
- 1 PART: Database content as SCAFFOLDING (the skeleton, anchor points, citations)
- 3 PARTS: YOUR CREATIVE ELABORATION including:
  * Historical context (connect to other philosophers, movements, eras)
  * Scientific parallels (draw from physics, biology, cognitive science, mathematics)
  * Concrete examples and thought experiments
  * Contemporary applications and implications
  * Extended analysis and original insights
  * Counter-arguments and responses

DATABASE SCAFFOLDING (cite with [P#], [Q#], [A#], [W#] but ELABORATE extensively):
${skeleton.databaseContent.positions.slice(0, 8).join("\n")}
${skeleton.databaseContent.quotes.slice(0, 6).join("\n")}
${skeleton.databaseContent.arguments.slice(0, 4).join("\n")}

THESIS TO DEVELOP: ${skeleton.thesis}

COMMITMENTS (must honor): ${skeleton.commitments.join("; ")}

${priorClaimsStr ? `CONTINUITY - Claims already made: ${priorClaimsStr}` : ""}

WRITING STYLE:
- Write as if for an educated general audience, not specialists
- Use vivid language, concrete imagery, and compelling examples
- Build arguments through sustained reasoning, not just assertion
- Connect ideas across domains - philosophy, science, history, culture
- NO markdown formatting - pure flowing prose
- NO meta-commentary about what you're doing - just DO IT
- NEVER say "In this section I will..." - just write the content

REMEMBER: ${minWords} WORDS MINIMUM. Dense, substantive, creative content.`;
  } else {
    system = `You are ${thinkerName}. Write in STANDARD MODE - strict database-grounded content.

WORD COUNT: AT LEAST ${minWords} words.

DATABASE CONTENT TO CITE (prefix paragraphs with codes):
${skeleton.databaseContent.positions.slice(0, 10).join("\n")}
${skeleton.databaseContent.quotes.slice(0, 10).join("\n")}
${skeleton.databaseContent.arguments.slice(0, 5).join("\n")}

THESIS: ${skeleton.thesis}
COMMITMENTS: ${skeleton.commitments.join("; ")}
KEY TERMS: ${Object.entries(skeleton.keyTerms).map(([k, v]) => `${k}: ${v}`).join("; ")}

${priorClaimsStr ? `PRIOR CLAIMS: ${priorClaimsStr}` : ""}

RULES:
1. Start paragraphs with citations [P#], [Q#], [A#], [W#]
2. Write AT LEAST ${minWords} words
3. Do NOT contradict commitments
4. No markdown - plain text only`;
  }

  const outlineSection = skeleton.outline[chunkIndex] || `Part ${chunkIndex + 1}`;
  
  const user = enhanced 
    ? `CHUNK ${chunkIndex + 1} OF ${totalChunks}: "${outlineSection}"

Write AT LEAST ${minWords} words of dense, creative philosophical content.

Use the database content as SCAFFOLDING (1 part) but add extensive creative elaboration (3 parts):
- Historical connections to other thinkers and movements
- Scientific analogies and parallels  
- Concrete examples and thought experiments
- Extended analysis with original insights
- Contemporary implications

Cite database items with [P#], [Q#], [A#], [W#] codes, then ELABORATE extensively on each point.

BEGIN WRITING NOW. No preamble. ${minWords}+ words required.`
    : `Chunk ${chunkIndex + 1} of ${totalChunks}: ${outlineSection}
Write AT LEAST ${minWords} words with database citations.`;

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

export async function processWithCoherence(options: CoherenceOptions): Promise<void> {
  const { sessionType, thinkerId, thinkerName, userPrompt, targetWords, model, enhanced, databaseContent, res } = options;

  const WORDS_PER_CHUNK = 1000;
  const totalChunks = Math.max(1, Math.ceil(targetWords / WORDS_PER_CHUNK));
  const wordsPerChunk = Math.ceil(targetWords / totalChunks);

  sendSSE(res, `\n=== PHASE 1: EXTRACTING SKELETON FROM DATABASE ===\n`);
  sendSSE(res, `Target: ${targetWords.toLocaleString()} words in ${totalChunks} chunks\n\n`);

  const sessionId = await createSession(options);

  const skeleton = await extractGlobalSkeleton(userPrompt, thinkerName, databaseContent, model);
  await updateSessionSkeleton(sessionId, skeleton, totalChunks);

  // Stream the full skeleton visibly for the user
  sendSSE(res, `\n──────────────────────────────────────────────────────────────\n`);
  sendSSE(res, `                    SKELETON (Downloadable)\n`);
  sendSSE(res, `──────────────────────────────────────────────────────────────\n\n`);
  
  sendSSE(res, `THESIS:\n${skeleton.thesis}\n\n`);
  
  sendSSE(res, `OUTLINE:\n`);
  skeleton.outline.forEach((section, i) => {
    sendSSE(res, `  ${i + 1}. ${section}\n`);
  });
  
  if (skeleton.commitments.length > 0) {
    sendSSE(res, `\nCOMMITMENTS:\n`);
    skeleton.commitments.forEach((c, i) => {
      sendSSE(res, `  ${i + 1}. ${c}\n`);
    });
  }
  
  if (Object.keys(skeleton.keyTerms).length > 0) {
    sendSSE(res, `\nKEY TERMS:\n`);
    Object.entries(skeleton.keyTerms).forEach(([term, def]) => {
      sendSSE(res, `  - ${term}: ${def}\n`);
    });
  }
  
  sendSSE(res, `\nDATABASE ITEMS:\n`);
  sendSSE(res, `  Positions: ${skeleton.databaseContent.positions.length}\n`);
  sendSSE(res, `  Quotes: ${skeleton.databaseContent.quotes.length}\n`);
  sendSSE(res, `  Arguments: ${skeleton.databaseContent.arguments.length}\n`);
  sendSSE(res, `  Works: ${skeleton.databaseContent.works.length}\n`);
  
  sendSSE(res, `\n──────────────────────────────────────────────────────────────\n\n`);
  
  // Send skeleton as JSON for frontend to capture (marked for extraction)
  sendSSE(res, `[SKELETON_JSON]${JSON.stringify(skeleton)}[/SKELETON_JSON]\n\n`);

  await delay(1000);

  sendSSE(res, `\n=== PHASE 2: GENERATING ${totalChunks} CHUNKS (with DB persistence) ===\n\n`);

  let totalOutput = "";
  let totalWordCount = 0;

  for (let i = 0; i < totalChunks; i++) {
    sendSSE(res, `\n--- CHUNK ${i + 1}/${totalChunks} (Target: ${wordsPerChunk} words) ---\n\n`);

    const dbSkeleton = await getSessionSkeleton(sessionId);
    if (!dbSkeleton) {
      sendSSE(res, `ERROR: Could not retrieve skeleton from database\n`);
      return;
    }

    const priorDeltas = await getPriorDeltas(sessionId);
    const { system, user } = buildChunkPrompt(dbSkeleton, i, totalChunks, wordsPerChunk, thinkerName, priorDeltas, enhanced);

    let chunkOutput = "";
    for await (const text of streamText({ model, systemPrompt: system, userPrompt: user, maxTokens: 4096 })) {
      chunkOutput += text;
      await streamTokensVisibly(res, text, 15);
    }

    const chunkWords = countWords(chunkOutput);
    totalOutput += chunkOutput + "\n\n";
    totalWordCount += chunkWords;

    const delta = extractDeltaFromOutput(chunkOutput, dbSkeleton);
    await saveChunk(sessionId, i, chunkOutput, delta, chunkWords);

    sendSSE(res, `\n\n[Chunk ${i + 1} saved to DB: ${chunkWords} words | Running total: ${totalWordCount}/${targetWords}]\n`);

    if (delta.conflictsDetected.length > 0) {
      sendSSE(res, `[WARNING: ${delta.conflictsDetected.length} potential conflicts detected]\n`);
    }

    if (i < totalChunks - 1) {
      sendSSE(res, `[Pausing 15 seconds for rate limit...]\n`);
      await delay(CHUNK_DELAY_MS);
    }
  }

  sendSSE(res, `\n\n=== PHASE 3: STITCH & VERIFY ===\n`);
  sendSSE(res, `Total generated: ${totalWordCount} words\n`);
  sendSSE(res, `Target: ${targetWords} words\n`);

  const allDeltas = await getPriorDeltas(sessionId);
  const allConflicts = allDeltas.flatMap(d => d.conflictsDetected || []);
  
  sendSSE(res, `Conflicts detected across chunks: ${allConflicts.length}\n`);
  
  if (totalWordCount < targetWords * 0.9) {
    const shortfall = targetWords - totalWordCount;
    sendSSE(res, `\nShortfall: ${shortfall} words. Generating additional content...\n\n`);
    
    const dbSkeleton = await getSessionSkeleton(sessionId);
    if (dbSkeleton) {
      const supplementPrompt = buildChunkPrompt(dbSkeleton, totalChunks, totalChunks + 1, shortfall, thinkerName, allDeltas, enhanced);
      let supplementOutput = "";
      for await (const text of streamText({ model, systemPrompt: supplementPrompt.system, userPrompt: supplementPrompt.user, maxTokens: 4096 })) {
        supplementOutput += text;
        await streamTokensVisibly(res, text, 15);
      }
      totalOutput += supplementOutput;
      totalWordCount = countWords(totalOutput);
      
      const delta = extractDeltaFromOutput(supplementOutput, dbSkeleton);
      await saveChunk(sessionId, totalChunks, supplementOutput, delta, countWords(supplementOutput));
    }
  }

  await saveStitchResult(sessionId, totalWordCount, allConflicts);

  sendSSE(res, `\n\n=== GENERATION COMPLETE ===\n`);
  sendSSE(res, `Final word count: ${totalWordCount}\n`);
  sendSSE(res, `Session ID: ${sessionId}\n`);
  sendSSE(res, `Status: ${allConflicts.length === 0 ? "PASS" : "NEEDS_REVIEW"}\n`);
}
