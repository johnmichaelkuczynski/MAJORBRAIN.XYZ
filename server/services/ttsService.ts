import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { THINKERS } from "@shared/schema";

const client = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY,
});

const VOICE_POOL = [
  { id: "pNInz6obpgDQGcFmaJgB", name: "Adam", gender: "male" },
  { id: "ErXwobaYiN019PkySvjV", name: "Antoni", gender: "male" },
  { id: "VR6AewLTigWG4xSOukaG", name: "Arnold", gender: "male" },
  { id: "pqHfZKP75CvOlQylNhV4", name: "Bill", gender: "male" },
  { id: "nPczCjzI2devNBz1zQrb", name: "Brian", gender: "male" },
  { id: "N2lVS1w4EtoT3dr4eOWO", name: "Callum", gender: "male" },
  { id: "IKne3meq5aSn9XLyUdCD", name: "Charlie", gender: "male" },
  { id: "XB0fDUnXU5powFXDhCwa", name: "Charlotte", gender: "female" },
  { id: "iP95p4xoKVk53GoZ742B", name: "Chris", gender: "male" },
  { id: "onwK4e9ZLuTAKqWW03F9", name: "Daniel", gender: "male" },
  { id: "cjVigY5qzO86Huf0OWal", name: "Eric", gender: "male" },
  { id: "JBFqnCBsd6RMkjVDRZzb", name: "George", gender: "male" },
  { id: "cgSgspJ2msm6clMCkdW9", name: "Jessica", gender: "female" },
  { id: "FGY2WhTYpPnrIDTdsKH5", name: "Laura", gender: "female" },
  { id: "TX3LPaxmHKxFdv7VOQHJ", name: "Liam", gender: "male" },
  { id: "pFZP5JQG7iQjIQuC4Bku", name: "Lily", gender: "female" },
  { id: "XrExE9yKIg1WjnnlVkGX", name: "Matilda", gender: "female" },
  { id: "SAz9YHcvj6GT2YYXdXww", name: "River", gender: "male" },
  { id: "CwhRBWXzGAHq8TQ4Fs17", name: "Roger", gender: "male" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah", gender: "female" },
];

interface DebateSpeech {
  speaker: string;
  text: string;
}

function parseDebateText(debateText: string): DebateSpeech[] {
  const speeches: DebateSpeech[] = [];
  const lines = debateText.split("\n");
  let currentSpeaker = "";
  let currentText = "";

  const knownNames = THINKERS.map(t => t.name);

  for (const line of lines) {
    let matched = false;

    for (const name of knownNames) {
      if (line.startsWith(name + ":") || line.startsWith(name.toUpperCase() + ":")) {
        if (currentSpeaker && currentText.trim()) {
          speeches.push({ speaker: currentSpeaker, text: currentText.trim() });
        }
        currentSpeaker = name;
        currentText = line.slice(line.indexOf(":") + 1);
        matched = true;
        break;
      }
    }

    if (!matched) {
      const speakerMatch = line.match(/^([A-Z][A-Za-z\s\-'.()]+?):\s*(.*)/);
      if (speakerMatch) {
        if (currentSpeaker && currentText.trim()) {
          speeches.push({ speaker: currentSpeaker, text: currentText.trim() });
        }
        currentSpeaker = speakerMatch[1].trim();
        currentText = speakerMatch[2] || "";
      } else {
        if (currentSpeaker) {
          currentText += "\n" + line;
        }
      }
    }
  }

  if (currentSpeaker && currentText.trim()) {
    speeches.push({ speaker: currentSpeaker, text: currentText.trim() });
  }

  if (speeches.length === 0 && debateText.trim()) {
    speeches.push({ speaker: "Narrator", text: debateText.trim() });
  }

  return speeches;
}

function assignVoices(speakers: string[]): Record<string, typeof VOICE_POOL[0]> {
  const assignments: Record<string, typeof VOICE_POOL[0]> = {};
  const usedIndices = new Set<number>();

  const femaleNames = new Set([
    "dworkin", "goldman", "arendt", "beauvoir", "wollstonecraft",
    "hypatia", "stanton", "truth", "luxemburg", "rand"
  ]);

  for (let i = 0; i < speakers.length; i++) {
    const speaker = speakers[i];
    const speakerLower = speaker.toLowerCase();

    const isFemale = femaleNames.has(speakerLower) ||
      THINKERS.some(t => t.name.toLowerCase() === speakerLower && femaleNames.has(t.id));

    const preferredGender = isFemale ? "female" : "male";

    let voiceIdx = VOICE_POOL.findIndex(
      (v, idx) => v.gender === preferredGender && !usedIndices.has(idx)
    );

    if (voiceIdx === -1) {
      voiceIdx = VOICE_POOL.findIndex((_, idx) => !usedIndices.has(idx));
    }

    if (voiceIdx === -1) {
      voiceIdx = i % VOICE_POOL.length;
    }

    usedIndices.add(voiceIdx);
    assignments[speaker] = VOICE_POOL[voiceIdx];
  }

  return assignments;
}

async function generateSpeechSegment(
  voiceId: string,
  text: string
): Promise<Buffer> {
  const cleanText = text
    .replace(/\[P\d+\]/g, "")
    .replace(/\[Q\d+\]/g, "")
    .replace(/\[A\d+\]/g, "")
    .replace(/\[W\d+\]/g, "")
    .replace(/\[CD\d+\]/g, "")
    .replace(/\[UD\d+\]/g, "")
    .replace(/\*\*/g, "")
    .replace(/\*/g, "")
    .replace(/#{1,6}\s/g, "")
    .trim();

  if (!cleanText) {
    return Buffer.alloc(0);
  }

  const audio = await client.textToSpeech.convert(voiceId, {
    text: cleanText,
    modelId: "eleven_multilingual_v2",
    voiceSettings: {
      stability: 0.65,
      similarityBoost: 0.75,
      style: 0.1,
      useSpeakerBoost: true,
    },
  });

  const chunks: Buffer[] = [];
  if (audio && typeof (audio as any)[Symbol.asyncIterator] === "function") {
    for await (const chunk of audio as unknown as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk));
    }
  } else if (audio && typeof (audio as any).getReader === "function") {
    const reader = (audio as any).getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
    }
  } else if (audio instanceof Buffer) {
    chunks.push(audio);
  } else if (audio instanceof ArrayBuffer || audio instanceof Uint8Array) {
    chunks.push(Buffer.from(audio));
  } else {
    chunks.push(Buffer.from(audio as any));
  }
  return Buffer.concat(chunks);
}

export async function generateDebateAudio(
  debateText: string,
  onProgress?: (msg: string) => void
): Promise<{ audio: Buffer; voiceMap: Record<string, string> }> {
  const speeches = parseDebateText(debateText);

  if (speeches.length === 0) {
    throw new Error("Could not parse any speaker segments from the debate text");
  }

  const uniqueSpeakers = Array.from(new Set(speeches.map(s => s.speaker)));
  const voiceAssignments = assignVoices(uniqueSpeakers);

  const voiceMap: Record<string, string> = {};
  for (const [speaker, voice] of Object.entries(voiceAssignments)) {
    voiceMap[speaker] = voice.name;
  }

  onProgress?.(`Parsed ${speeches.length} speech segments from ${uniqueSpeakers.length} speakers`);
  onProgress?.(`Voice assignments: ${uniqueSpeakers.map(s => `${s} → ${voiceAssignments[s].name}`).join(", ")}`);

  const audioSegments: Buffer[] = [];

  for (let i = 0; i < speeches.length; i++) {
    const speech = speeches[i];
    const voice = voiceAssignments[speech.speaker];

    onProgress?.(`Generating audio ${i + 1}/${speeches.length}: ${speech.speaker} (${speech.text.split(/\s+/).length} words)...`);

    try {
      const segment = await generateSpeechSegment(voice.id, speech.text);
      if (segment.length > 0) {
        audioSegments.push(segment);
      }
    } catch (err: any) {
      console.error(`[TTS] Error generating segment ${i + 1} for ${speech.speaker}:`, err.message);
      onProgress?.(`Warning: Failed to generate audio for segment ${i + 1} (${speech.speaker}), skipping...`);
    }
  }

  if (audioSegments.length === 0) {
    throw new Error("No audio segments were generated successfully");
  }

  const combined = Buffer.concat(audioSegments);
  onProgress?.(`Audio generation complete! ${audioSegments.length} segments, ${(combined.length / 1024 / 1024).toFixed(1)} MB`);

  return { audio: combined, voiceMap };
}

export { parseDebateText, assignVoices };
