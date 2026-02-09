import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export type AIProvider = "openai" | "anthropic";
export type ModelId = "gpt-4o" | "gpt-4o-mini" | "claude-sonnet-4" | "claude-haiku-4-5";

export interface StreamCallbacks {
  onChunk: (text: string) => void;
  onComplete: (fullText: string) => void;
  onError: (error: Error) => void;
}

export interface GenerationOptions {
  model: ModelId;
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
  temperature?: number;
}

export function getProvider(model: ModelId): AIProvider {
  return model.startsWith("gpt-") ? "openai" : "anthropic";
}

export async function generateText(options: GenerationOptions): Promise<string> {
  const { model, systemPrompt, userPrompt, maxTokens = 4096, temperature = 0.7 } = options;
  const provider = getProvider(model);

  if (provider === "openai") {
    const response = await openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      max_tokens: maxTokens,
      temperature,
    });
    return response.choices[0]?.message?.content || "";
  } else {
    const response = await anthropic.messages.create({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });
    const textBlock = response.content.find((b: any) => b.type === "text");
    return textBlock ? (textBlock as any).text : "";
  }
}

export async function* streamText(options: GenerationOptions): AsyncGenerator<string, void, unknown> {
  const { model, systemPrompt, userPrompt, maxTokens = 4096, temperature = 0.7 } = options;
  const provider = getProvider(model);

  if (provider === "openai") {
    const stream = await openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      max_tokens: maxTokens,
      temperature,
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        yield content;
      }
    }
  } else {
    const stream = await anthropic.messages.stream({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });

    for await (const event of stream) {
      if (event.type === "content_block_delta" && (event.delta as any).type === "text_delta") {
        yield (event.delta as any).text;
      }
    }
  }
}

export async function streamTextWithCallbacks(
  options: GenerationOptions,
  callbacks: StreamCallbacks
): Promise<void> {
  try {
    let fullText = "";
    for await (const chunk of streamText(options)) {
      fullText += chunk;
      callbacks.onChunk(chunk);
    }
    callbacks.onComplete(fullText);
  } catch (error) {
    callbacks.onError(error instanceof Error ? error : new Error(String(error)));
  }
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export const CHUNK_DELAY_MS = 2000;
