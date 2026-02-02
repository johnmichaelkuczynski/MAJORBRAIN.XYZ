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
  priorDeltas: ChunkDelta[]
): { system: string; user: string } {
  const priorClaimsStr = priorDeltas.flatMap(d => d.claimsAdded || []).join("; ");
  const priorTermsStr = priorDeltas.flatMap(d => d.termsUsed || []).join(", ");
  
  const system = `You are ${thinkerName}. You MUST write AT LEAST ${targetWordsPerChunk} words for this chunk.

GLOBAL SKELETON FROM DATABASE (DO NOT CONTRADICT):
- THESIS: ${skeleton.thesis}
- COMMITMENTS: ${skeleton.commitments.join("; ")}
- KEY TERMS: ${Object.entries(skeleton.keyTerms).map(([k, v]) => `${k}: ${v}`).join("; ")}

DATABASE CONTENT TO CITE (USE THESE CODES):
${skeleton.databaseContent.positions.slice(0, 10).join("\n")}
${skeleton.databaseContent.quotes.slice(0, 10).join("\n")}
${skeleton.databaseContent.arguments.slice(0, 5).join("\n")}

${priorClaimsStr ? `PRIOR CLAIMS ALREADY MADE (DO NOT CONTRADICT): ${priorClaimsStr}` : ""}
${priorTermsStr ? `TERMS ALREADY USED: ${priorTermsStr}` : ""}

RULES:
1. Start EVERY paragraph with a citation [P#], [Q#], [A#], or [W#]
2. Write AT LEAST ${targetWordsPerChunk} words - NO EXCEPTIONS
3. Do NOT contradict the skeleton commitments or prior claims
4. Do NOT use markdown - plain text only
5. 100% substance - NO filler, NO disclaimers`;

  const outlineSection = skeleton.outline[chunkIndex] || `Part ${chunkIndex + 1}`;
  
  const user = `This is chunk ${chunkIndex + 1} of ${totalChunks}.
Focus on: ${outlineSection}

Write AT LEAST ${targetWordsPerChunk} words. Start every paragraph with a database citation.`;

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
  const { sessionType, thinkerId, thinkerName, userPrompt, targetWords, model, databaseContent, res } = options;

  const WORDS_PER_CHUNK = 1000;
  const totalChunks = Math.max(1, Math.ceil(targetWords / WORDS_PER_CHUNK));
  const wordsPerChunk = Math.ceil(targetWords / totalChunks);

  sendSSE(res, `\n=== PHASE 1: CREATING SESSION & EXTRACTING SKELETON ===\n`);
  sendSSE(res, `Target: ${targetWords.toLocaleString()} words in ${totalChunks} chunks\n\n`);

  const sessionId = await createSession(options);
  sendSSE(res, `Session ID: ${sessionId}\n`);

  const skeleton = await extractGlobalSkeleton(userPrompt, thinkerName, databaseContent, model);
  await updateSessionSkeleton(sessionId, skeleton, totalChunks);

  sendSSE(res, `SKELETON EXTRACTED & STORED IN DATABASE:\n`);
  sendSSE(res, `- Thesis: ${skeleton.thesis}\n`);
  sendSSE(res, `- Outline: ${skeleton.outline.length} sections\n`);
  sendSSE(res, `- Commitments: ${skeleton.commitments.length}\n`);
  sendSSE(res, `- Database items: ${skeleton.databaseContent.positions.length} positions, ${skeleton.databaseContent.quotes.length} quotes\n\n`);

  await delay(2000);

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
    const { system, user } = buildChunkPrompt(dbSkeleton, i, totalChunks, wordsPerChunk, thinkerName, priorDeltas);

    let chunkOutput = "";
    for await (const text of streamText({ model, systemPrompt: system, userPrompt: user, maxTokens: 4096 })) {
      chunkOutput += text;
      sendSSE(res, text);
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
      const supplementPrompt = buildChunkPrompt(dbSkeleton, totalChunks, totalChunks + 1, shortfall, thinkerName, allDeltas);
      let supplementOutput = "";
      for await (const text of streamText({ model, systemPrompt: supplementPrompt.system, userPrompt: supplementPrompt.user, maxTokens: 4096 })) {
        supplementOutput += text;
        sendSSE(res, text);
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
