import { Response } from "express";
import { generateText, streamText, countWords, delay, CHUNK_DELAY_MS, ModelId } from "./aiProviderService";

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
  const priorClaimsStr = priorDeltas.flatMap(d => d.claimsAdded).join("; ");
  
  const system = `You are ${thinkerName}. You MUST write AT LEAST ${targetWordsPerChunk} words for this chunk.

GLOBAL SKELETON (DO NOT CONTRADICT):
- THESIS: ${skeleton.thesis}
- COMMITMENTS: ${skeleton.commitments.join("; ")}
- KEY TERMS: ${Object.entries(skeleton.keyTerms).map(([k, v]) => `${k}: ${v}`).join("; ")}

DATABASE CONTENT TO CITE (USE THESE CODES):
${skeleton.databaseContent.positions.slice(0, 10).join("\n")}
${skeleton.databaseContent.quotes.slice(0, 10).join("\n")}
${skeleton.databaseContent.arguments.slice(0, 5).join("\n")}

RULES:
1. Start EVERY paragraph with a citation [P#], [Q#], [A#], or [W#]
2. Write AT LEAST ${targetWordsPerChunk} words - NO EXCEPTIONS
3. Do NOT contradict the skeleton commitments
4. Do NOT use markdown - plain text only
5. 100% substance - NO filler, NO disclaimers`;

  const outlineSection = skeleton.outline[chunkIndex] || `Part ${chunkIndex + 1}`;
  
  const user = `This is chunk ${chunkIndex + 1} of ${totalChunks}.
Focus on: ${outlineSection}

${priorClaimsStr ? `PRIOR CLAIMS MADE: ${priorClaimsStr}` : "This is the first chunk."}

Write AT LEAST ${targetWordsPerChunk} words. Start every paragraph with a database citation.`;

  return { system, user };
}

export async function processWithCoherence(options: CoherenceOptions): Promise<void> {
  const { sessionType, thinkerId, thinkerName, userPrompt, targetWords, model, databaseContent, res } = options;

  const WORDS_PER_CHUNK = 1000;
  const totalChunks = Math.max(1, Math.ceil(targetWords / WORDS_PER_CHUNK));
  const wordsPerChunk = Math.ceil(targetWords / totalChunks);

  sendSSE(res, `\n=== PHASE 1: EXTRACTING SKELETON ===\n`);
  sendSSE(res, `Target: ${targetWords.toLocaleString()} words in ${totalChunks} chunks\n\n`);

  const skeleton = await extractGlobalSkeleton(userPrompt, thinkerName, databaseContent, model);

  sendSSE(res, `SKELETON EXTRACTED:\n`);
  sendSSE(res, `- Thesis: ${skeleton.thesis}\n`);
  sendSSE(res, `- Outline: ${skeleton.outline.length} sections\n`);
  sendSSE(res, `- Commitments: ${skeleton.commitments.length}\n`);
  sendSSE(res, `- Database items: ${skeleton.databaseContent.positions.length} positions, ${skeleton.databaseContent.quotes.length} quotes\n\n`);

  await delay(2000);

  sendSSE(res, `\n=== PHASE 2: GENERATING ${totalChunks} CHUNKS ===\n\n`);

  const allDeltas: ChunkDelta[] = [];
  let totalOutput = "";
  let totalWordCount = 0;

  for (let i = 0; i < totalChunks; i++) {
    sendSSE(res, `\n--- CHUNK ${i + 1}/${totalChunks} (Target: ${wordsPerChunk} words) ---\n\n`);

    const { system, user } = buildChunkPrompt(skeleton, i, totalChunks, wordsPerChunk, thinkerName, allDeltas);

    let chunkOutput = "";
    for await (const text of streamText({ model, systemPrompt: system, userPrompt: user, maxTokens: 4096 })) {
      chunkOutput += text;
      sendSSE(res, text);
    }

    const chunkWords = countWords(chunkOutput);
    totalOutput += chunkOutput + "\n\n";
    totalWordCount += chunkWords;

    const delta: ChunkDelta = {
      claimsAdded: [],
      termsUsed: [],
      conflictsDetected: [],
      continuityNotes: `Chunk ${i + 1} completed`,
    };
    allDeltas.push(delta);

    sendSSE(res, `\n\n[Chunk ${i + 1} complete: ${chunkWords} words | Running total: ${totalWordCount}/${targetWords}]\n`);

    if (i < totalChunks - 1) {
      sendSSE(res, `[Pausing 15 seconds for rate limit...]\n`);
      await delay(CHUNK_DELAY_MS);
    }
  }

  sendSSE(res, `\n\n=== PHASE 3: STITCH CHECK ===\n`);
  sendSSE(res, `Total generated: ${totalWordCount} words\n`);
  sendSSE(res, `Target: ${targetWords} words\n`);
  sendSSE(res, `Status: ${totalWordCount >= targetWords * 0.9 ? "PASS" : "NEEDS MORE"}\n`);
  
  if (totalWordCount < targetWords * 0.9) {
    const shortfall = targetWords - totalWordCount;
    sendSSE(res, `\nShortfall: ${shortfall} words. Generating additional content...\n\n`);
    
    const supplementPrompt = buildChunkPrompt(skeleton, totalChunks, totalChunks + 1, shortfall, thinkerName, allDeltas);
    for await (const text of streamText({ model, systemPrompt: supplementPrompt.system, userPrompt: supplementPrompt.user, maxTokens: 4096 })) {
      totalOutput += text;
      sendSSE(res, text);
    }
    totalWordCount = countWords(totalOutput);
  }

  sendSSE(res, `\n\n=== GENERATION COMPLETE ===\n`);
  sendSSE(res, `Final word count: ${totalWordCount}\n`);
}

export async function processSimpleChat(
  thinkerName: string,
  userPrompt: string,
  model: ModelId,
  databaseContent: CoherenceOptions["databaseContent"],
  wordCount: number,
  res: Response
): Promise<void> {
  const positionTexts = databaseContent.positions.slice(0, 20).map((p: any, i: number) => 
    `[P${i + 1}] ${p.positionText || p.position_text}`
  );
  const quoteTexts = databaseContent.quotes.slice(0, 20).map((q: any, i: number) => 
    `[Q${i + 1}] "${q.quoteText || q.quote_text}"`
  );

  const systemPrompt = `You are ${thinkerName}. Respond using the database content below.

DATABASE CONTENT:
${positionTexts.join("\n")}
${quoteTexts.join("\n")}

RULES:
1. Start EVERY paragraph with [P#] or [Q#] citation
2. Write AT LEAST ${wordCount} words
3. NO markdown - plain text only
4. 100% substance`;

  for await (const text of streamText({ model, systemPrompt, userPrompt, maxTokens: 4096 })) {
    sendSSE(res, text);
  }
}
