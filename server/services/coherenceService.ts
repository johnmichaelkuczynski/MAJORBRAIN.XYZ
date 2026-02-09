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
  commonDocument?: string;
  commonDocCitations?: string[];
  databaseContent: {
    positions: string[];
    quotes: string[];
    arguments: string[];
    works: string[];
  };
  perSpeakerContent?: Record<string, {
    positions: string[];
    quotes: string[];
    arguments: string[];
    works: string[];
  }>;
}

function extractDocumentCitations(documentText: string, maxCitations: number = 20): string[] {
  const citations: string[] = [];
  const sentences = documentText
    .replace(/\r\n/g, "\n")
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 30 && s.length < 500);
  
  const keyIndicators = [
    /\b(argues?|claims?|contends?|maintains?|asserts?|holds?|believes?)\b/i,
    /\b(therefore|thus|hence|consequently|because|since)\b/i,
    /\b(must|should|cannot|ought|fundamental|essential|critical)\b/i,
    /\b(problem|question|challenge|objection|critique|failure|limit)\b/i,
    /\b(truth|knowledge|reason|rational|moral|justice|freedom|reality)\b/i,
    /\b(religion|god|faith|divine|sacred|secular|spiritual)\b/i,
    /["']/,
  ];
  
  const scored = sentences.map(s => {
    let score = 0;
    for (const pattern of keyIndicators) {
      if (pattern.test(s)) score++;
    }
    if (s.length > 60 && s.length < 300) score++;
    return { text: s, score };
  });
  
  scored.sort((a, b) => b.score - a.score);
  
  const selected = scored.slice(0, maxCitations);
  
  for (let i = 0; i < selected.length; i++) {
    citations.push(`[CD${i + 1}] "${selected[i].text}"`);
  }
  
  return citations;
}

export interface ChunkDelta {
  claimsAdded: string[];
  termsUsed: string[];
  conflictsDetected: string[];
  continuityNotes: string;
}

export interface MaterialItem {
  code: string;
  text: string;
  speaker: string;
  used: boolean;
  source: "database" | "uploaded";
}

export interface ClaimLogEntry {
  speaker: string;
  claim: string;
  citationCodes: string[];
  turnIndex: number;
}

export interface MaterialTracker {
  items: MaterialItem[];
  claimLog: ClaimLogEntry[];
  totalTurns: number;
}

function createMaterialTracker(): MaterialTracker {
  return { items: [], claimLog: [], totalTurns: 0 };
}

function addMaterialItems(tracker: MaterialTracker, formattedItems: string[], speaker: string, source: "database" | "uploaded"): void {
  for (const item of formattedItems) {
    const codeMatch = item.match(/^\[([^\]]+)\]/);
    if (codeMatch) {
      const textAfterCode = item.replace(/^\[[^\]]+\]\s*/, "");
      tracker.items.push({
        code: codeMatch[1],
        text: textAfterCode,
        speaker,
        used: false,
        source,
      });
    }
  }
}

function markMaterialUsed(tracker: MaterialTracker, citationCodes: string[], speaker?: string): void {
  for (const code of citationCodes) {
    const cleanCode = code.replace(/[\[\]]/g, "");
    const item = speaker
      ? tracker.items.find(i => i.code === cleanCode && i.speaker === speaker && !i.used)
      : tracker.items.find(i => i.code === cleanCode && !i.used);
    if (item) item.used = true;
  }
}

function getUnusedMaterial(tracker: MaterialTracker, speaker?: string): MaterialItem[] {
  return tracker.items.filter(i => !i.used && (!speaker || i.speaker === speaker));
}

function getExhaustionRatio(tracker: MaterialTracker, speaker?: string): number {
  const relevant = speaker ? tracker.items.filter(i => i.speaker === speaker) : tracker.items;
  if (relevant.length === 0) return 0;
  const used = relevant.filter(i => i.used).length;
  return used / relevant.length;
}

function addClaimToLog(tracker: MaterialTracker, speaker: string, claim: string, citationCodes: string[]): void {
  tracker.claimLog.push({ speaker, claim, citationCodes, turnIndex: tracker.totalTurns });
}

function isClaimRepetitive(tracker: MaterialTracker, candidateClaim: string): boolean {
  const candidateWords = new Set(candidateClaim.toLowerCase().split(/\s+/).filter(w => w.length > 4));
  if (candidateWords.size < 3) return false;

  for (const entry of tracker.claimLog) {
    const entryWords = new Set(entry.claim.toLowerCase().split(/\s+/).filter(w => w.length > 4));
    let overlap = 0;
    const candidateArr = Array.from(candidateWords);
    for (let ci = 0; ci < candidateArr.length; ci++) {
      if (entryWords.has(candidateArr[ci])) overlap++;
    }
    const similarity = overlap / Math.max(candidateWords.size, entryWords.size);
    if (similarity > 0.6) return true;
  }
  return false;
}

function serializeMaterialStatusForPrompt(tracker: MaterialTracker, speakers: string[]): string {
  let output = "\n=== MATERIAL USAGE STATUS ===\n";
  for (const speaker of speakers) {
    const speakerItems = tracker.items.filter(i => i.speaker === speaker);
    const unused = speakerItems.filter(i => !i.used);
    const used = speakerItems.filter(i => i.used);
    const ratio = speakerItems.length > 0 ? (used.length / speakerItems.length * 100).toFixed(0) : "0";

    output += `\n${speaker}: ${used.length}/${speakerItems.length} items used (${ratio}%)\n`;
    if (unused.length > 0) {
      output += `  UNUSED (MUST USE THESE NEXT):\n`;
      unused.slice(0, 8).forEach(i => {
        output += `    [${i.code}] ${i.text.substring(0, 120)}...\n`;
      });
    }
    if (used.length > 0) {
      output += `  ALREADY USED (DO NOT REPEAT): ${used.map(i => `[${i.code}]`).join(", ")}\n`;
    }
  }
  output += "=== END MATERIAL STATUS ===\n";
  return output;
}

function serializeClaimLogForPrompt(tracker: MaterialTracker): string {
  if (tracker.claimLog.length === 0) return "";
  let output = "\n=== RUNNING CLAIM LOG (EVERY claim made so far - DO NOT REPEAT ANY) ===\n";
  for (const entry of tracker.claimLog.slice(-30)) {
    output += `  ${entry.speaker} (turn ${entry.turnIndex}): ${entry.claim}`;
    if (entry.citationCodes.length > 0) output += ` [cited: ${entry.citationCodes.join(", ")}]`;
    output += "\n";
  }
  output += "=== END CLAIM LOG ===\n";
  return output;
}

function extractClaimsFromOutput(text: string, speakers: string[]): { speaker: string; claim: string; citations: string[] }[] {
  const claims: { speaker: string; claim: string; citations: string[] }[] = [];
  const lines = text.split("\n").filter(l => l.trim().length > 0);

  for (const line of lines) {
    const speakerMatch = line.match(/^([^:]+):\s*(.*)/);
    if (!speakerMatch) continue;

    const speakerName = speakerMatch[1].trim();
    const turnText = speakerMatch[2].trim();
    const matched = speakers.find(s => s.toLowerCase() === speakerName.toLowerCase());
    if (!matched) continue;

    const citations = (turnText.match(/\[([A-Z]+\d+)\]/g) || []).map(c => c.replace(/[\[\]]/g, ""));

    const sentences = turnText.split(/(?<=[.!?])\s+/).filter(s => s.length > 20);
    for (const sentence of sentences) {
      const sentenceCitations = (sentence.match(/\[([A-Z]+\d+)\]/g) || []).map(c => c.replace(/[\[\]]/g, ""));
      claims.push({
        speaker: matched,
        claim: sentence.substring(0, 200),
        citations: sentenceCitations.length > 0 ? sentenceCitations : citations.slice(0, 2),
      });
    }
  }
  return claims;
}

export interface DialogueStateTracker {
  citedPositions: Record<string, Set<string>>;
  claimsMade: Record<string, string[]>;
  concessionsMade: Record<string, string[]>;
  synthesisAttempts: string[];
  turnCount: Record<string, number>;
  allTurnsText: Record<string, string[]>;
  materialTracker: MaterialTracker;
}

function createDialogueStateTracker(speakers: string[]): DialogueStateTracker {
  const tracker: DialogueStateTracker = {
    citedPositions: {},
    claimsMade: {},
    concessionsMade: {},
    synthesisAttempts: [],
    turnCount: {},
    allTurnsText: {},
    materialTracker: createMaterialTracker(),
  };
  for (const speaker of speakers) {
    tracker.citedPositions[speaker] = new Set();
    tracker.claimsMade[speaker] = [];
    tracker.concessionsMade[speaker] = [];
    tracker.turnCount[speaker] = 0;
    tracker.allTurnsText[speaker] = [];
  }
  return tracker;
}

function updateDialogueState(tracker: DialogueStateTracker, chunkOutput: string, speakers: string[]): void {
  const lines = chunkOutput.split("\n").filter(l => l.trim().length > 0);

  const allNewClaims = extractClaimsFromOutput(chunkOutput, speakers);
  for (const claim of allNewClaims) {
    addClaimToLog(tracker.materialTracker, claim.speaker, claim.claim, claim.citations);
    markMaterialUsed(tracker.materialTracker, claim.citations, claim.speaker);
    tracker.materialTracker.totalTurns++;
  }

  for (const line of lines) {
    const speakerMatch = line.match(/^([^:]+):\s*(.*)/);
    if (!speakerMatch) continue;

    const speakerName = speakerMatch[1].trim();
    const turnText = speakerMatch[2].trim();

    const matchedSpeaker = speakers.find(s =>
      s.toLowerCase() === speakerName.toLowerCase()
    );
    if (!matchedSpeaker) continue;

    if (!tracker.turnCount[matchedSpeaker]) tracker.turnCount[matchedSpeaker] = 0;
    tracker.turnCount[matchedSpeaker]++;

    if (!tracker.allTurnsText[matchedSpeaker]) tracker.allTurnsText[matchedSpeaker] = [];
    tracker.allTurnsText[matchedSpeaker].push(turnText);

    const citationMatches = turnText.match(/\[([A-Z]+\d+)\]/g);
    if (citationMatches) {
      if (!tracker.citedPositions[matchedSpeaker]) tracker.citedPositions[matchedSpeaker] = new Set<string>();
      for (let ci = 0; ci < citationMatches.length; ci++) {
        tracker.citedPositions[matchedSpeaker].add(citationMatches[ci]);
      }
    }

    const claimIndicators = /\b(I argue|I claim|I maintain|I hold|I contend|my position|I assert|I believe|my view)\b/i;
    if (claimIndicators.test(turnText)) {
      const claimSummary = turnText.substring(0, 120);
      if (!tracker.claimsMade[matchedSpeaker]) tracker.claimsMade[matchedSpeaker] = [];
      tracker.claimsMade[matchedSpeaker].push(claimSummary);
    }

    const concessionIndicators = /\b(you are (right|correct)|I concede|I grant|I accept your|you make a (fair|valid|good) point|I was wrong|I must revise|I now see|I acknowledge|that is correct|I stand corrected)\b/i;
    if (concessionIndicators.test(turnText)) {
      if (!tracker.concessionsMade[matchedSpeaker]) tracker.concessionsMade[matchedSpeaker] = [];
      tracker.concessionsMade[matchedSpeaker].push(turnText.substring(0, 120));
    }

    const synthesisIndicators = /\b(combining|synthesis|integrate|if we merge|drawing from both|your point.*my point|bridging|reconcil)\b/i;
    if (synthesisIndicators.test(turnText)) {
      tracker.synthesisAttempts.push(`${matchedSpeaker}: ${turnText.substring(0, 120)}`);
    }
  }
}

function computeTextOverlap(text1: string, text2: string): number {
  const wordsArr1 = text1.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const words2 = new Set(text2.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  if (wordsArr1.length === 0 || words2.size === 0) return 0;
  const uniqueWords1 = Array.from(new Set(wordsArr1));
  let overlap = 0;
  for (let i = 0; i < uniqueWords1.length; i++) {
    if (words2.has(uniqueWords1[i])) overlap++;
  }
  return overlap / Math.max(uniqueWords1.length, words2.size);
}

function checkChunkRepetition(tracker: DialogueStateTracker, newChunkText: string, speakers: string[]): { isRepetitive: boolean; worstSpeaker: string; overlapScore: number } {
  let worstSpeaker = "";
  let maxOverlap = 0;

  const newLines = newChunkText.split("\n").filter(l => l.trim().length > 0);

  for (const speaker of speakers) {
    const priorTurns = tracker.allTurnsText[speaker] || [];
    if (priorTurns.length === 0) continue;

    const priorCombined = priorTurns.join(" ");
    const newSpeakerTurns = newLines
      .filter(l => l.toLowerCase().startsWith(speaker.toLowerCase() + ":"))
      .map(l => l.replace(/^[^:]+:\s*/, ""))
      .join(" ");

    if (newSpeakerTurns.length < 20) continue;

    const overlap = computeTextOverlap(priorCombined, newSpeakerTurns);
    if (overlap > maxOverlap) {
      maxOverlap = overlap;
      worstSpeaker = speaker;
    }
  }

  return { isRepetitive: maxOverlap > 0.7, worstSpeaker, overlapScore: maxOverlap };
}

function serializeTrackerForPrompt(tracker: DialogueStateTracker, speakers: string[]): string {
  let output = "\n=== DIALOGUE STATE (DO NOT REPEAT ANY OF THIS) ===\n";

  for (const speaker of speakers) {
    const cited = tracker.citedPositions[speaker];
    const citedArr = cited ? Array.from(cited) : [];
    const claims = tracker.claimsMade[speaker] || [];
    const concessions = tracker.concessionsMade[speaker] || [];
    const turns = tracker.turnCount[speaker] || 0;

    output += `\n${speaker} (${turns} turns so far):\n`;
    if (citedArr.length > 0) {
      output += `  ALREADY CITED (DO NOT REUSE): ${citedArr.join(", ")}\n`;
    }
    if (claims.length > 0) {
      output += `  CLAIMS ALREADY MADE (DO NOT RESTATE):\n`;
      claims.slice(-8).forEach(c => { output += `    - ${c}\n`; });
    }
    if (concessions.length > 0) {
      output += `  CONCESSIONS MADE:\n`;
      concessions.forEach(c => { output += `    - ${c}\n`; });
    }
  }

  if (tracker.synthesisAttempts.length > 0) {
    output += `\nSYNTHESIS ATTEMPTS SO FAR:\n`;
    tracker.synthesisAttempts.forEach(s => { output += `  - ${s}\n`; });
  }

  output += "\n=== END DIALOGUE STATE ===\n";

  output += serializeMaterialStatusForPrompt(tracker.materialTracker, speakers);
  output += serializeClaimLogForPrompt(tracker.materialTracker);

  return output;
}

export interface CoherenceOptions {
  sessionType: "chat" | "debate" | "interview" | "dialogue" | "document";
  thinkerId: string;
  thinkerName: string;
  secondSpeaker?: string;
  allSpeakers?: string[];
  perSpeakerContent?: Record<string, {
    positions: any[];
    quotes: any[];
    arguments: any[];
    works: any[];
  }>;
  userPrompt: string;
  commonDocument?: string;
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

function formatDbContent(items: any[], type: "P" | "Q" | "A" | "W", speakerName: string, limit: number = 20): string[] {
  const regularItems = items.filter((item: any) => !item._uploadedDoc);
  const uploadedItems = items.filter((item: any) => item._uploadedDoc);

  const formatted = regularItems.slice(0, limit).map((item: any, i: number) => {
    const code = `[${type}${i + 1}]`;
    if (type === "P") return `${code} ${item.positionText || item.position_text}`;
    if (type === "Q") return `${code} "${item.quoteText || item.quote_text}"`;
    if (type === "A") return `${code} ${item.argumentText || item.argument_text}`;
    if (type === "W") return `${code} ${(item.workText || item.work_text || '').substring(0, 500)}...`;
    return "";
  });

  // Format uploaded document items with [UD#] codes
  const uploadedFormatted = uploadedItems.slice(0, 50).map((item: any, i: number) => {
    const code = `[UD${item._udIndex || (i + 1)}]`;
    return `${code} ${item.positionText || item.position_text}`;
  });

  return [...formatted, ...uploadedFormatted];
}

export async function extractGlobalSkeleton(
  userPrompt: string,
  thinkerName: string,
  databaseContent: CoherenceOptions["databaseContent"],
  model: ModelId,
  perSpeakerContent?: CoherenceOptions["perSpeakerContent"],
  allSpeakers?: string[]
): Promise<GlobalSkeleton> {
  const regularPositions = databaseContent.positions.filter((p: any) => !p._uploadedDoc);
  const uploadedPositions = databaseContent.positions.filter((p: any) => p._uploadedDoc);
  const positionTexts = regularPositions.slice(0, 20).map((p: any, i: number) => 
    `[P${i + 1}] ${p.positionText || p.position_text}`
  );
  const uploadedTexts = uploadedPositions.slice(0, 50).map((p: any, i: number) => 
    `[UD${p._udIndex || (i + 1)}] ${p.positionText || p.position_text}`
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
${uploadedTexts.length > 0 ? `\nUPLOADED MATERIAL:\n${uploadedTexts.join("\n")}` : ""}

Return ONLY the JSON skeleton.`;

  let parsedSkeleton: any = null;
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
      parsedSkeleton = JSON.parse(jsonMatch[0]);
    }
  } catch (error) {
    console.error("Skeleton extraction error:", error);
  }

  const result: GlobalSkeleton = {
    thesis: parsedSkeleton?.thesis || userPrompt,
    outline: parsedSkeleton?.outline || ["Introduction", "Main Analysis", "Conclusion"],
    keyTerms: parsedSkeleton?.keyTerms || {},
    commitments: parsedSkeleton?.commitments || [],
    entities: parsedSkeleton?.entities || [],
    databaseContent: {
      positions: [...positionTexts, ...uploadedTexts],
      quotes: quoteTexts,
      arguments: argumentTexts,
      works: workTexts,
    },
  };

  if (perSpeakerContent && allSpeakers) {
    result.perSpeakerContent = {};
    for (const speaker of allSpeakers) {
      const sc = perSpeakerContent[speaker];
      if (sc) {
        result.perSpeakerContent[speaker] = {
          positions: formatDbContent(sc.positions, "P", speaker, 15),
          quotes: formatDbContent(sc.quotes, "Q", speaker, 15),
          arguments: formatDbContent(sc.arguments, "A", speaker, 8),
          works: formatDbContent(sc.works, "W", speaker, 3),
        };
      }
    }
  }

  return result;
}

function buildChunkPrompt(
  skeleton: GlobalSkeleton,
  chunkIndex: number,
  totalChunks: number,
  targetWordsPerChunk: number,
  thinkerName: string,
  priorDeltas: ChunkDelta[],
  enhanced: boolean = true,
  sessionType: "chat" | "debate" | "interview" | "dialogue" | "document" = "document",
  secondSpeaker: string = "Interviewer",
  allSpeakers?: string[],
  dialogueState?: DialogueStateTracker,
  commonDocument?: string
): { system: string; user: string } {
  const priorClaimsStr = priorDeltas.flatMap(d => d.claimsAdded || []).join("; ");
  const minWords = Math.ceil(targetWordsPerChunk * 1.2);
  
  let formatInstructions = "";
  
  if (sessionType === "interview") {
    formatInstructions = `
=== MANDATORY INTERVIEW FORMAT ===
This is an INTERVIEW with clear Q&A turns. EVERY line must start with a speaker name and colon.

EXACT FORMAT REQUIRED:
${secondSpeaker}: [interviewer asks a question]
${thinkerName}: [interviewee gives substantive answer]

${secondSpeaker}: [next question]
${thinkerName}: [next answer]

RULES:
- Alternate between ${secondSpeaker} asking questions and ${thinkerName} answering
- ${secondSpeaker} asks probing follow-up questions based on answers
- ${thinkerName} gives substantive answers (3-6 sentences each)
- NO essay paragraphs. ONLY speaker turns with "NAME: text" format
- Every single line of output must start with either "${secondSpeaker}:" or "${thinkerName}:"
`;
  } else if (sessionType === "debate" && allSpeakers && allSpeakers.length > 2) {
    const speakerList = allSpeakers.join(", ");
    formatInstructions = `
=== MANDATORY MULTI-SPEAKER DEBATE FORMAT ===
This is a DEBATE with ${allSpeakers.length} speakers: ${speakerList}
ALL speakers must participate actively. EVERY line must start with a speaker name and colon.

EXACT FORMAT REQUIRED:
${allSpeakers[0]}: [makes an argument or claim, citing their database items]
${allSpeakers[1]}: [challenges or responds, citing their own database items]
${allSpeakers[2]}: [adds perspective or disagrees, citing their database items]
${allSpeakers.length > 3 ? `${allSpeakers[3]}: [contributes their view, citing their database items]\n` : ""}

ANTI-REPETITION RULES (HARD CONSTRAINT):
- Before generating any turn, check the RUNNING CLAIM LOG below
- If the point about to be made matches ANY prior claim (same logical claim, same objection structure, same counterexample pattern), REJECT IT and generate a different turn
- Swapping proper names, analogies, or examples while making the identical argument COUNTS AS REPETITION
- The ONLY permissible re-invocation of a prior idea is as a premise in a GENUINELY NEW argument with a clearly stated NEW conclusion
- If re-invoking, reference the idea briefly (do not re-argue) and immediately deploy toward the new conclusion

MATERIAL EXHAUSTION RULES (HARD CONSTRAINT):
- Check the MATERIAL USAGE STATUS below for each speaker's UNUSED items
- Each turn MUST draw from UNUSED material FIRST
- Select the strongest unused argument/position that is responsive to the opponent's most recent point
- Only if NO unused material is responsive may you generate content not directly from uploads
- Even then, you must NOT repeat previously used material
- A shorter non-repetitive debate is ALWAYS preferable to a longer repetitive one

RULES:
- ALL ${allSpeakers.length} speakers MUST appear in EVERY chunk
- Speakers DISAGREE, CHALLENGE, and DEBATE each other
- Each turn is a direct response to previous speakers
- Sharp, pointed exchanges - no agreement or pleasantries
- NO essay paragraphs. ONLY speaker turns with "NAME: text" format
- Every single line of output must start with one of: ${allSpeakers.map(s => `"${s}:"`).join(", ")}
- Each speaker cites THEIR OWN database items (marked with their name)
- Rotate through all speakers - do not skip anyone
`;
  } else if (sessionType === "debate") {
    formatInstructions = `
=== MANDATORY DEBATE FORMAT ===
This is a DEBATE with opposing speakers taking turns. EVERY line must start with a speaker name and colon.

EXACT FORMAT REQUIRED:
${thinkerName}: [makes an argument or claim]
${secondSpeaker}: [challenges, disagrees, or counters]

${thinkerName}: [responds to challenge]
${secondSpeaker}: [further objection or rebuttal]

ANTI-REPETITION RULES (HARD CONSTRAINT):
- Before generating any turn, check the RUNNING CLAIM LOG below
- If the point about to be made matches ANY prior claim (same logical claim, same objection structure, same counterexample pattern), REJECT IT and generate a different turn
- Swapping proper names, analogies, or examples while making the identical argument COUNTS AS REPETITION
- The ONLY permissible re-invocation of a prior idea is as a premise in a GENUINELY NEW argument with a clearly stated NEW conclusion

MATERIAL EXHAUSTION RULES (HARD CONSTRAINT):
- Check the MATERIAL USAGE STATUS below for each speaker's UNUSED items
- Each turn MUST draw from UNUSED material FIRST
- Select the strongest unused argument/position that is responsive to the opponent's most recent point
- Only if NO unused material is responsive may you generate content not directly from uploads
- Even then, you must NOT repeat previously used material
- A shorter non-repetitive debate is ALWAYS preferable to a longer repetitive one

RULES:
- Speakers DISAGREE and CHALLENGE each other
- Each turn is a direct response to the previous speaker
- Sharp, pointed exchanges - no agreement or pleasantries
- NO essay paragraphs. ONLY speaker turns with "NAME: text" format
- Every single line of output must start with either "${thinkerName}:" or "${secondSpeaker}:"
`;
  } else if (sessionType === "dialogue" && allSpeakers && allSpeakers.length > 2) {
    const speakerList = allSpeakers.join(", ");
    formatInstructions = `
=== MANDATORY MULTI-SPEAKER DIALOGUE FORMAT ===
This is a DIALOGUE with ${allSpeakers.length} speakers: ${speakerList}
ALL speakers must participate. EVERY line must start with a speaker name and colon.

FORMAT: "SPEAKER_NAME: [what they say]"

=== DIALECTICAL PROGRESSION RULES (MANDATORY) ===
EVERY turn MUST satisfy at least ONE of these three conditions. NO EXCEPTIONS:

(a) NEW EVIDENCE: Introduce a position or quote from the database NOT YET CITED.
    The citation must be substantively integrated, not decoratively appended.

(b) GENUINE CONCESSION: Explicitly acknowledge another speaker's point is correct
    or partially correct AND modify your own position. "I see your point, but..."
    followed by restating your original position does NOT count.

(c) NOVEL SYNTHESIS: Produce a claim combining elements from at least two speakers'
    positions into something new that neither has said before.

ANTI-REPETITION RULES:
- NEVER restate a position already stated in a prior turn
- NEVER cite a database item already cited (check the DIALOGUE STATE below)
- NEVER use the same phrasing or argument structure twice
- If you cannot advance the argument, END the dialogue with a synthesis/conclusion
RULES:
- All ${allSpeakers.length} speakers rotate through turns
- Each turn DIRECTLY responds to what was just said
- Speakers must change their minds, introduce new evidence, or synthesize
- NO parallel monologues - this is a REAL conversation with intellectual progression
- NO essay paragraphs. ONLY speaker turns with "NAME: text" format
`;
  } else if (sessionType === "dialogue") {
    formatInstructions = `
=== MANDATORY DIALOGUE FORMAT ===
This is a DIALOGUE between ${thinkerName} and ${secondSpeaker}. EVERY line must start with a speaker name and colon.

FORMAT: "${thinkerName}: [what they say]" then "${secondSpeaker}: [their response]"

=== DIALECTICAL PROGRESSION RULES (MANDATORY) ===
EVERY turn MUST satisfy at least ONE of these three conditions. NO EXCEPTIONS:

(a) NEW EVIDENCE: Introduce a position or quote from the database NOT YET CITED.
    The citation must be substantively integrated, not decoratively appended.

(b) GENUINE CONCESSION: Explicitly acknowledge the other speaker's point is correct
    or partially correct AND modify your own position. "I see your point, but..."
    followed by restating your original position does NOT count.

(c) NOVEL SYNTHESIS: Produce a claim combining elements from both speakers'
    positions into something new that neither has said before.

ANTI-REPETITION RULES:
- NEVER restate a position already stated in a prior turn
- NEVER cite a database item already cited (check the DIALOGUE STATE below)
- NEVER use the same phrasing or argument structure twice
- If you cannot advance the argument, END the dialogue with a synthesis/conclusion
RULES:
- Natural back-and-forth with intellectual PROGRESSION
- Each turn DIRECTLY responds to what was just said
- Speakers must change their minds, introduce new evidence, or synthesize
- NO parallel monologues - this is a REAL conversation
- NO essay paragraphs. ONLY speaker turns with "NAME: text" format
- Every line must start with either "${thinkerName}:" or "${secondSpeaker}:"
`;
  }

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
  
  const isConversation = sessionType === "interview" || sessionType === "debate" || sessionType === "dialogue";
  const isMultiSpeaker = (sessionType === "debate" || sessionType === "dialogue") && allSpeakers && allSpeakers.length > 2 && skeleton.perSpeakerContent;
  const dialogueStateStr = dialogueState && allSpeakers ? serializeTrackerForPrompt(dialogueState, allSpeakers) : 
                           dialogueState ? serializeTrackerForPrompt(dialogueState, [thinkerName, secondSpeaker]) : "";
  
  if (isMultiSpeaker && skeleton.perSpeakerContent) {
    let perSpeakerSection = "";
    for (const speaker of allSpeakers!) {
      const sc = skeleton.perSpeakerContent[speaker];
      if (sc) {
        const citedSet = dialogueState?.citedPositions[speaker];
        const uncitedPositions = citedSet ? sc.positions.filter(p => !citedSet.has(p.match(/\[([^\]]+)\]/)?.[0] || "")) : sc.positions;
        const uncitedQuotes = citedSet ? sc.quotes.filter(q => !citedSet.has(q.match(/\[([^\]]+)\]/)?.[0] || "")) : sc.quotes;
        const uncitedArgs = citedSet ? sc.arguments.filter(a => !citedSet.has(a.match(/\[([^\]]+)\]/)?.[0] || "")) : sc.arguments;

        perSpeakerSection += `\n=== ${speaker.toUpperCase()}'S DATABASE CONTENT (${speaker} MUST cite THESE) ===\n`;
        perSpeakerSection += `${speaker}'s UNCITED POSITIONS (use these NEXT):\n${uncitedPositions.slice(0, 6).join("\n")}\n`;
        perSpeakerSection += `${speaker}'s UNCITED QUOTES:\n${uncitedQuotes.slice(0, 5).join("\n")}\n`;
        perSpeakerSection += `${speaker}'s UNCITED ARGUMENTS:\n${uncitedArgs.slice(0, 4).join("\n")}\n\n`;
      }
    }

    system = `You are generating a ${allSpeakers!.length}-SPEAKER ${sessionType.toUpperCase()}.

=== YOUR ROLE ===
You are the VOICE, not the BRAIN. The database content below IS the brain.
Every substantive claim must trace to a specific database item. You articulate the retrieved
material in natural dialogue voice. You DO NOT generate your own version of what these
thinkers "probably" think. You DO NOT substitute generic LLM knowledge about them.

${formatInstructions}
${coreRules}

${perSpeakerSection}

TOPIC: ${skeleton.thesis}
${(() => {
  const docText = commonDocument || skeleton.commonDocument;
  const docCitations = skeleton.commonDocCitations || (docText ? extractDocumentCitations(docText) : []);
  if (!docText || docCitations.length === 0) return "";
  return `
=== SOURCE DOCUMENT: VERBATIM QUOTABLE PASSAGES (CITE AS [CD1], [CD2], etc.) ===
THIS IS THE UPLOADED DOCUMENT THAT ALL SPEAKERS MUST QUOTE FROM DIRECTLY.
Every debater MUST use [CD#] codes to quote specific passages from this document.
These are EXACT QUOTES from the source text - use them VERBATIM in quotation marks.

${docCitations.join("\n")}

=== END SOURCE DOCUMENT CITATIONS ===

DOCUMENT CITATION RULES (MANDATORY - ZERO TOLERANCE):
- EVERY speaker turn MUST include at least one [CD#] citation quoting the source document
- Use the EXACT text from the [CD#] items above in quotation marks
- Speakers should AGREE WITH, CHALLENGE, INTERPRET, or BUILD UPON these specific passages
- [CD#] citations are IN ADDITION TO [P#], [Q#], [A#] database citations
- A turn without any [CD#] citation is a FAILED turn
`;
})()}
${dialogueStateStr}

${priorClaimsStr ? `PRIOR CLAIMS MADE: ${priorClaimsStr}` : ""}

=== GROUNDING REQUIREMENTS (ZERO TOLERANCE FOR VIOLATION) ===
EVERY speaker's response MUST:
1. CITE their own database content with codes: [P1], [P2], [Q1], [Q2], [A1], etc.
2. USE the EXACT positions, quotes, and arguments listed under THEIR name above
3. NOT fabricate or invent positions not in the database
4. Quote directly from [Q#] items when making claims
5. Reference specific [P#] positions when explaining views
6. EVERY turn by EVERY speaker must include at least 2 citation codes
7. ONLY cite items from the UNCITED lists above - never re-cite already-used items
${(commonDocument || skeleton.commonDocument) ? `8. EVERY turn MUST ALSO cite at least one [CD#] passage from the SOURCE DOCUMENT above
9. [CD#] citations use the VERBATIM text from the uploaded document in quotation marks` : ""}

THE LLM MUST NOT FREELANCE:
- WRONG (generic cliche): "${allSpeakers![0]}: I believe psychological explanations are complex and involve many factors..."
${(commonDocument || skeleton.commonDocument) ? `- WRONG (ignoring source document): "${allSpeakers![0]}: Religion serves as a psychological projection [P1]..." (no [CD#] citation!)
- RIGHT (document-grounded): "${allSpeakers![0]}: The source text states that 'religion cannot be reduced to mere psychological projection' [CD3]. I disagree - as my database positions show, religion IS projection [P1]. As I wrote, 'religious beliefs are wish fulfillments' [Q2]."` 
: `- RIGHT (database-grounded): "${allSpeakers![0]}: The DN model fails in psychological explanation [P1]. As I wrote, 'the cause of many a psychological event is known' [Q2]. This argument [A1] shows..."`}
- If a thinker has no database positions on a sub-topic, they acknowledge this honestly.

CRITICAL: ALL ${allSpeakers!.length} speakers must appear. Output ONLY speaker turns. Format: "NAME: text"`;
  } else if (isConversation) {
    const hasPerSpeaker = sessionType === "dialogue" && skeleton.perSpeakerContent && allSpeakers;
    let contentSection = "";

    if (hasPerSpeaker && skeleton.perSpeakerContent && allSpeakers) {
      for (const speaker of allSpeakers) {
        const sc = skeleton.perSpeakerContent[speaker];
        if (sc) {
          const citedSet = dialogueState?.citedPositions[speaker];
          const uncitedPositions = citedSet ? sc.positions.filter(p => !citedSet.has(p.match(/\[([^\]]+)\]/)?.[0] || "")) : sc.positions;
          const uncitedQuotes = citedSet ? sc.quotes.filter(q => !citedSet.has(q.match(/\[([^\]]+)\]/)?.[0] || "")) : sc.quotes;
          const uncitedArgs = citedSet ? sc.arguments.filter(a => !citedSet.has(a.match(/\[([^\]]+)\]/)?.[0] || "")) : sc.arguments;

          contentSection += `\n=== ${speaker.toUpperCase()}'S UNCITED DATABASE CONTENT (cite THESE next) ===\n`;
          contentSection += `POSITIONS:\n${uncitedPositions.slice(0, 8).join("\n")}\n`;
          contentSection += `QUOTES:\n${uncitedQuotes.slice(0, 6).join("\n")}\n`;
          contentSection += `ARGUMENTS:\n${uncitedArgs.slice(0, 4).join("\n")}\n`;
        }
      }
    } else {
      contentSection = `
=== ${thinkerName.toUpperCase()}'S ACTUAL INDEXED POSITIONS (MANDATORY - CITE THESE) ===
${skeleton.databaseContent.positions.slice(0, 8).join("\n")}

=== ${thinkerName.toUpperCase()}'S ACTUAL QUOTES (MANDATORY - USE WITH [Q#] CODES) ===
${skeleton.databaseContent.quotes.slice(0, 6).join("\n")}

=== ${thinkerName.toUpperCase()}'S ACTUAL ARGUMENTS (MANDATORY - CITE WITH [A#]) ===
${skeleton.databaseContent.arguments.slice(0, 4).join("\n")}`;
    }

    system = `You are generating a ${sessionType.toUpperCase()}.

=== YOUR ROLE ===
You are the VOICE, not the BRAIN. The database content below IS the brain.
Every substantive claim must trace to a specific database item. You articulate the retrieved
material in natural dialogue voice. You DO NOT fabricate what thinkers "probably" think.

${formatInstructions}
${coreRules}

${contentSection}

TOPIC: ${skeleton.thesis}
${(() => {
  const docText = commonDocument || skeleton.commonDocument;
  const docCitations = skeleton.commonDocCitations || (docText ? extractDocumentCitations(docText) : []);
  if (!docText || docCitations.length === 0) return "";
  return `
=== SOURCE DOCUMENT: VERBATIM QUOTABLE PASSAGES (CITE AS [CD1], [CD2], etc.) ===
THIS IS THE UPLOADED DOCUMENT THAT ALL SPEAKERS MUST QUOTE FROM DIRECTLY.
Every speaker MUST use [CD#] codes to quote specific passages from this document.
These are EXACT QUOTES from the source text - use them VERBATIM in quotation marks.

${docCitations.join("\n")}

=== END SOURCE DOCUMENT CITATIONS ===

DOCUMENT CITATION RULES (MANDATORY - ZERO TOLERANCE):
- EVERY speaker turn MUST include at least one [CD#] citation quoting the source document
- Use the EXACT text from the [CD#] items above in quotation marks
- Speakers should AGREE WITH, CHALLENGE, INTERPRET, or BUILD UPON these specific passages
- [CD#] citations are IN ADDITION TO [P#], [Q#], [A#] database citations
- A turn without any [CD#] citation is a FAILED turn
`;
})()}
${dialogueStateStr}

${priorClaimsStr ? `PRIOR CLAIMS MADE: ${priorClaimsStr}` : ""}

=== GROUNDING REQUIREMENTS (ZERO TOLERANCE FOR VIOLATION) ===
ALL speakers' responses MUST:
1. CITE database content with codes: [P1], [P2], [Q1], [Q2], [A1], etc.
2. USE the EXACT positions, quotes, and arguments from above
3. NOT fabricate or invent positions not in the database
4. Quote directly from [Q#] items when making claims
5. Reference specific [P#] positions when explaining views
6. ONLY cite items from the UNCITED lists - never re-cite already-used items
${(commonDocument || skeleton.commonDocument) ? `7. EVERY turn MUST ALSO cite at least one [CD#] passage from the SOURCE DOCUMENT
8. [CD#] citations use the VERBATIM text from the uploaded document in quotation marks` : ""}

THE LLM MUST NOT FREELANCE:
- If a thinker has no database positions on a sub-topic, they acknowledge this honestly.
- DO NOT substitute generic LLM knowledge about these thinkers.
${(commonDocument || skeleton.commonDocument) ? `- DO NOT ignore the source document. Every turn MUST quote from it using [CD#] codes.` : ""}

CRITICAL: Output ONLY speaker turns. Format: "NAME: text"
NO essays. NO paragraphs. ONLY alternating speaker turns.
EVERY speaker response MUST include at least 2 citation codes [P#], [Q#], or [A#]${(commonDocument || skeleton.commonDocument) ? " AND at least 1 [CD#] source document citation" : ""}.`;
  } else if (enhanced) {
    system = `You ARE ${thinkerName}. Speak in FIRST PERSON.

=== YOUR ROLE ===
You are the VOICE for ${thinkerName}'s actual database content. The database IS the brain.
In Enhanced mode, you use database items as scaffolding and elaborate with examples and applications.
But every core claim must still trace to a database item. No freelancing on core positions.

${coreRules}

=== DATABASE CONTENT (Your actual positions - USE THESE AS SCAFFOLDING) ===
${skeleton.databaseContent.positions.slice(0, 8).join("\n")}
${skeleton.databaseContent.quotes.slice(0, 6).join("\n")}
${skeleton.databaseContent.arguments.slice(0, 4).join("\n")}

THESIS: ${skeleton.thesis}
COMMITMENTS: ${skeleton.commitments.join("; ")}

${priorClaimsStr ? `PRIOR CLAIMS MADE: ${priorClaimsStr}` : ""}

=== ENHANCED MODE (1:3 RATIO) ===
- 1 part: Database content (cite with [P#], [Q#], [A#], [W#])
- 3 parts: Your elaboration with examples, history, applications
- Core claims must cite database items; elaboration extends them
- Always speak as "I" - never third person
- DO NOT USE MARKDOWN. Plain text only.`;
  } else {
    system = `You ARE ${thinkerName}. Speak in FIRST PERSON.

=== YOUR ROLE ===
You are the VOICE, not the BRAIN. The database content below IS the brain.
Every substantive claim must trace to a specific database item.
You DO NOT fabricate positions. You DO NOT substitute generic knowledge.

${coreRules}

=== DATABASE CONTENT (Your actual positions - CITE THESE) ===
${skeleton.databaseContent.positions.slice(0, 10).join("\n")}
${skeleton.databaseContent.quotes.slice(0, 10).join("\n")}
${skeleton.databaseContent.arguments.slice(0, 5).join("\n")}

THESIS: ${skeleton.thesis}
COMMITMENTS: ${skeleton.commitments.join("; ")}
KEY TERMS: ${Object.entries(skeleton.keyTerms).map(([k, v]) => `${k}: ${v}`).join("; ")}

${priorClaimsStr ? `PRIOR CLAIMS MADE: ${priorClaimsStr}` : ""}

=== STRICT DATABASE GROUNDING (ZERO TOLERANCE FOR VIOLATION) ===
- Every substantive claim MUST cite a database item [P#], [Q#], [A#], [W#]
- DO NOT fabricate positions the thinker "probably" holds
- If you have no database positions on a sub-topic, acknowledge this honestly
- Speak in FIRST PERSON as yourself
- DO NOT USE MARKDOWN. Plain text only.`;
  }

  const outlineSection = skeleton.outline[chunkIndex] || `Part ${chunkIndex + 1}`;
  
  let user: string;
  
  if (isMultiSpeaker) {
    const isDialogue = sessionType === "dialogue";
    const turnInfo = dialogueState ? Object.entries(dialogueState.turnCount).map(([s, c]) => `${s}: ${c} turns`).join(", ") : "";
    const isDebate = sessionType === "debate";
    const hasDoc = !!(commonDocument || skeleton.commonDocument);
    const docRef = hasDoc ? `
MANDATORY: Every speaker turn MUST include at least one [CD#] citation from the SOURCE DOCUMENT.
Quote the exact text from the [CD#] items. Argue about it. Challenge it. Interpret it. Apply database positions TO it.
A turn without [CD#] is FAILED.` : "";
    user = `Continue the ${allSpeakers!.length}-speaker ${sessionType} on: "${outlineSection}"

Write ${minWords}+ words as alternating speaker turns.
ALL ${allSpeakers!.length} speakers (${allSpeakers!.join(", ")}) MUST appear in this section.
Format: "SPEAKER_NAME: [what they say with [P#], [Q#], [A#]${hasDoc ? ", [CD#]" : ""} citations]"
${docRef}
${turnInfo ? `\nTurn counts so far: ${turnInfo}` : ""}

Start with ${allSpeakers![chunkIndex % allSpeakers!.length]}:

BEGIN NOW with speaker turns only. Every speaker must cite their UNCITED database items${hasDoc ? " AND quote the source document with [CD#] codes" : ""}.`;
  } else if (isConversation) {
    const isDialogue = sessionType === "dialogue";
    const turnInfo = dialogueState ? Object.entries(dialogueState.turnCount).map(([s, c]) => `${s}: ${c} turns`).join(", ") : "";
    const docRef2 = (commonDocument || skeleton.commonDocument) ? `\nIMPORTANT: Speakers must DIRECTLY DISCUSS the COMMON DOCUMENT provided above. Quote specific passages, argue about its claims, and apply your database positions TO the document's content.` : "";
    user = `Continue the ${sessionType} on: "${outlineSection}"

Write ${minWords}+ words as alternating speaker turns.
Format: "SPEAKER_NAME: [what they say]"
${docRef2}
${turnInfo ? `\nTurn counts so far: ${turnInfo}` : ""}

Start with ${chunkIndex % 2 === 0 ? (sessionType === "interview" ? secondSpeaker : thinkerName) : (sessionType === "interview" ? thinkerName : secondSpeaker)}:

BEGIN NOW with speaker turns only.`;
  } else {
    user = `Section: "${outlineSection}"

Write ${minWords}+ words. First person. Direct. No filler. Cite sources [P#], [Q#], [A#], [W#].

BEGIN NOW.`;
  }

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

function sendSkeletonSSE(res: Response, data: string) {
  res.write(`data: ${JSON.stringify({ type: "skeleton", content: data })}\n\n`);
  if (typeof (res as any).flush === "function") {
    (res as any).flush();
  }
}

function sendContentSSE(res: Response, data: string) {
  res.write(`data: ${JSON.stringify({ type: "content", content: data })}\n\n`);
  if (typeof (res as any).flush === "function") {
    (res as any).flush();
  }
}

export async function processWithCoherence(options: CoherenceOptions): Promise<void> {
  const { sessionType, thinkerId, thinkerName, secondSpeaker = "Interviewer", allSpeakers, perSpeakerContent, userPrompt, commonDocument: rawCommonDoc, targetWords, model, enhanced, databaseContent, res } = options;

  let commonDocument = rawCommonDoc || "";
  if (!commonDocument && userPrompt.includes("--- DOCUMENT TO DISCUSS ---")) {
    const docMatch = userPrompt.split("--- DOCUMENT TO DISCUSS ---");
    if (docMatch[1]) {
      commonDocument = docMatch[1].trim();
      console.log(`[COHERENCE] Extracted common document from topic: ${commonDocument.length} chars`);
    }
  }

  const WORDS_PER_CHUNK = 1000;
  const totalChunks = Math.max(1, Math.ceil(targetWords / WORDS_PER_CHUNK));
  const wordsPerChunk = Math.ceil(targetWords / totalChunks);

  sendSkeletonSSE(res, `Building skeleton from database...\n`);
  sendSkeletonSSE(res, `Target: ${targetWords.toLocaleString()} words\n\n`);

  sendContentSSE(res, `[Searching database and building structure...]\n\n`);

  let sessionId: string;
  try {
    sessionId = await createSession(options);
  } catch (err: any) {
    console.error("[COHERENCE] Session creation failed:", err);
    sendContentSSE(res, `Error creating session: ${err.message}\n`);
    return;
  }

  let skeleton: GlobalSkeleton;
  try {
    const truncatedPrompt = userPrompt.length > 8000
      ? userPrompt.substring(0, 8000) + "\n[Document truncated for skeleton extraction]"
      : userPrompt;
    skeleton = await extractGlobalSkeleton(truncatedPrompt, thinkerName, databaseContent, model, perSpeakerContent, allSpeakers);
    if (commonDocument) {
      skeleton.commonDocument = commonDocument;
      skeleton.commonDocCitations = extractDocumentCitations(commonDocument);
      console.log(`[COHERENCE] Extracted ${skeleton.commonDocCitations.length} document citations for debate`);
    }
    await updateSessionSkeleton(sessionId, skeleton, totalChunks);
  } catch (err: any) {
    console.error("[COHERENCE] Skeleton extraction failed:", err);
    sendContentSSE(res, `[Skeleton extraction error - generating directly...]\n\n`);
    skeleton = {
      thesis: userPrompt.substring(0, 200),
      outline: Array.from({ length: totalChunks }, (_, i) => `Part ${i + 1}`),
      keyTerms: {},
      commitments: [],
      entities: [],
      commonDocument: commonDocument || undefined,
      commonDocCitations: commonDocument ? extractDocumentCitations(commonDocument) : undefined,
      databaseContent: {
        positions: databaseContent.positions.slice(0, 20).map((p: any, i: number) => `[P${i + 1}] ${p.positionText || p.position_text}`),
        quotes: databaseContent.quotes.slice(0, 20).map((q: any, i: number) => `[Q${i + 1}] "${q.quoteText || q.quote_text}"`),
        arguments: databaseContent.arguments.slice(0, 10).map((a: any, i: number) => `[A${i + 1}] ${a.argumentText || a.argument_text}`),
        works: databaseContent.works.slice(0, 5).map((w: any, i: number) => `[W${i + 1}] ${(w.workText || w.work_text || '').substring(0, 500)}`),
      },
    };
    if (perSpeakerContent && allSpeakers) {
      skeleton.perSpeakerContent = {};
      for (const speaker of allSpeakers) {
        const sc = perSpeakerContent[speaker];
        if (sc) {
          skeleton.perSpeakerContent[speaker] = {
            positions: formatDbContent(sc.positions, "P", speaker, 15),
            quotes: formatDbContent(sc.quotes, "Q", speaker, 15),
            arguments: formatDbContent(sc.arguments, "A", speaker, 8),
            works: formatDbContent(sc.works, "W", speaker, 3),
          };
        }
      }
    }
    try { await updateSessionSkeleton(sessionId, skeleton, totalChunks); } catch {}
  }

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

  if (skeleton.perSpeakerContent) {
    sendSkeletonSSE(res, `\nPER-SPEAKER CONTENT\n`);
    for (const [speaker, sc] of Object.entries(skeleton.perSpeakerContent)) {
      sendSkeletonSSE(res, `${speaker}: ${sc.positions.length}P, ${sc.quotes.length}Q, ${sc.arguments.length}A, ${sc.works.length}W\n`);
    }
  }
  
  sendSkeletonSSE(res, `\n[SKELETON_COMPLETE]\n`);

  await delay(300);

  let totalOutput = "";
  let totalWordCount = 0;

  const isDialogueType = sessionType === "dialogue" || sessionType === "debate";
  const speakers = allSpeakers || [thinkerName, secondSpeaker];
  const dialogueState = isDialogueType ? createDialogueStateTracker(speakers) : undefined;
  const MAX_TURNS_PER_SPEAKER = Math.max(12, Math.ceil(targetWords / 300));

  if (dialogueState && skeleton.perSpeakerContent) {
    for (const speaker of speakers) {
      const sc = skeleton.perSpeakerContent[speaker];
      if (sc) {
        const dbPositions = sc.positions.filter(p => !p.startsWith("[UD"));
        const udPositions = sc.positions.filter(p => p.startsWith("[UD"));
        addMaterialItems(dialogueState.materialTracker, dbPositions, speaker, "database");
        addMaterialItems(dialogueState.materialTracker, udPositions, speaker, "uploaded");
        addMaterialItems(dialogueState.materialTracker, sc.quotes, speaker, "database");
        addMaterialItems(dialogueState.materialTracker, sc.arguments, speaker, "database");
      }
    }
    console.log(`[COHERENCE] Material tracker initialized: ${dialogueState.materialTracker.items.length} total items across ${speakers.length} speakers`);
  }

  for (let i = 0; i < totalChunks; i++) {
    const dbSkeleton = await getSessionSkeleton(sessionId);
    if (!dbSkeleton) {
      console.error("Could not retrieve skeleton from database");
      sendContentSSE(res, "\n\nError: Could not retrieve skeleton from database.\n");
      return;
    }

    if (dialogueState) {
      const alreadyMetTarget = totalWordCount >= targetWords * 0.85;

      const globalExhaustion = getExhaustionRatio(dialogueState.materialTracker);
      const hasEnoughTrackedItems = dialogueState.materialTracker.items.length >= 6;
      if (globalExhaustion >= 0.9 && i > 0 && hasEnoughTrackedItems && alreadyMetTarget) {
        console.log(`[COHERENCE] Material exhaustion at ${(globalExhaustion * 100).toFixed(0)}%. Generating final conclusion.`);
        sendContentSSE(res, `\n\n[Source material ${(globalExhaustion * 100).toFixed(0)}% exhausted. Concluding debate.]\n\n`);

        const conclusionPrompt = `All uploaded and database material has been substantially deployed (${(globalExhaustion * 100).toFixed(0)}% used). Write a FINAL CONCLUDING exchange (300-500 words) where:
1. Each speaker summarizes their strongest argument from the material already cited
2. Each speaker acknowledges one point where their opponent was strongest
3. End with each speaker's final position
Format: "SPEAKER_NAME: text". Do NOT introduce new arguments. Do NOT repeat prior arguments. Summarize and conclude.`;

        let conclusionOutput = "";
        try {
          for await (const text of streamText({ model, systemPrompt: dbSkeleton ? buildChunkPrompt(dbSkeleton, i, totalChunks, 500, thinkerName, [], enhanced, sessionType, secondSpeaker, allSpeakers, dialogueState, commonDocument).system : "", userPrompt: conclusionPrompt, maxTokens: 2000 })) {
            conclusionOutput += text;
            sendContentSSE(res, text);
          }
        } catch (err: any) {
          console.error("[COHERENCE] Conclusion generation error:", err);
        }

        if (conclusionOutput) {
          updateDialogueState(dialogueState, conclusionOutput, speakers);
          totalOutput += conclusionOutput + "\n\n";
          totalWordCount += countWords(conclusionOutput);
          const delta = extractDeltaFromOutput(conclusionOutput, dbSkeleton);
          await saveChunk(sessionId, i, conclusionOutput, delta, countWords(conclusionOutput));
        }
        break;
      }
    }

    const priorDeltas = await getPriorDeltas(sessionId);
    const { system, user } = buildChunkPrompt(dbSkeleton, i, totalChunks, wordsPerChunk, thinkerName, priorDeltas, enhanced, sessionType, secondSpeaker, allSpeakers, dialogueState, commonDocument);

    let chunkOutput = "";
    
    try {
      for await (const text of streamText({ model, systemPrompt: system, userPrompt: user, maxTokens: 4096 })) {
        chunkOutput += text;
        sendContentSSE(res, text);
      }
    } catch (err: any) {
      console.error(`[COHERENCE] Chunk ${i + 1} generation error:`, err);
      sendContentSSE(res, `\n\n[Generation error in section ${i + 1}: ${err.message}]\n\n`);
      if (chunkOutput.length === 0) {
        if (i === 0) {
          sendContentSSE(res, `[Unable to generate content. Please try again.]\n`);
          return;
        }
        sendContentSSE(res, `[Attempting to continue with available content...]\n\n`);
        continue;
      }
    }

    if (dialogueState) {
      updateDialogueState(dialogueState, chunkOutput, speakers);
      const totalTurns = Object.values(dialogueState.turnCount).reduce((a, b) => a + b, 0);
      const exhaustionRatio = getExhaustionRatio(dialogueState.materialTracker);
      console.log(`[COHERENCE] Dialogue state: ${totalTurns} turns, material ${(exhaustionRatio * 100).toFixed(0)}% used, ${dialogueState.materialTracker.claimLog.length} claims logged`);
    }

    const chunkWords = countWords(chunkOutput);
    totalOutput += chunkOutput + "\n\n";
    totalWordCount += chunkWords;

    const delta = extractDeltaFromOutput(chunkOutput, dbSkeleton);
    await saveChunk(sessionId, i, chunkOutput, delta, chunkWords);

    console.log(`[COHERENCE] Chunk ${i + 1}/${totalChunks}: ${chunkWords} words | Total: ${totalWordCount}/${targetWords}`);

    if (i < totalChunks - 1) {
      sendContentSSE(res, "\n\n");
      await delay(2000);
    }
  }

  if (totalWordCount < targetWords * 0.9 && !isDialogueType) {
    const shortfall = targetWords - totalWordCount;
    console.log(`[COHERENCE] Shortfall: ${shortfall} words. Generating supplement...`);
    
    const dbSkeleton = await getSessionSkeleton(sessionId);
    if (dbSkeleton) {
      const supplementPrompt = buildChunkPrompt(dbSkeleton, totalChunks, totalChunks + 1, shortfall, thinkerName, await getPriorDeltas(sessionId), enhanced, sessionType, secondSpeaker, allSpeakers, dialogueState, commonDocument);
      let supplementOutput = "";
      
      sendContentSSE(res, "\n\n");
      try {
        for await (const text of streamText({ model, systemPrompt: supplementPrompt.system, userPrompt: supplementPrompt.user, maxTokens: 4096 })) {
          supplementOutput += text;
          sendContentSSE(res, text);
        }
      } catch (err: any) {
        console.error("[COHERENCE] Supplement generation error:", err);
      }
      if (supplementOutput) {
        totalOutput += supplementOutput;
        totalWordCount = countWords(totalOutput);
        const delta = extractDeltaFromOutput(supplementOutput, dbSkeleton);
        await saveChunk(sessionId, totalChunks, supplementOutput, delta, countWords(supplementOutput));
      }
    }
  }

  const allDeltas = await getPriorDeltas(sessionId);
  const allConflicts = allDeltas.flatMap(d => d.conflictsDetected || []);
  await saveStitchResult(sessionId, totalWordCount, allConflicts);

  if (dialogueState) {
    const finalExhaustion = getExhaustionRatio(dialogueState.materialTracker);
    sendContentSSE(res, `\n\n[Word Count: ${totalWordCount.toLocaleString()} | Material Used: ${(finalExhaustion * 100).toFixed(0)}% | Claims Logged: ${dialogueState.materialTracker.claimLog.length}]`);
  } else {
    sendContentSSE(res, `\n\n[Word Count: ${totalWordCount.toLocaleString()}]`);
  }

  console.log(`[COHERENCE] Complete: ${totalWordCount} words | Session: ${sessionId} | Conflicts: ${allConflicts.length}`);
}
