import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const venice = process.env.VENICE_API_KEY
  ? new OpenAI({ apiKey: process.env.VENICE_API_KEY, baseURL: "https://api.venice.ai/api/v1" })
  : null;

export type AIProvider = "openai" | "anthropic" | "venice";

export const VENICE_MODELS = [
  "venice/zai-org-glm-5-1",
  "venice/grok-4-3",
  "venice/claude-opus-4-7",
  "venice/claude-sonnet-4-6",
  "venice/openai-gpt-55",
  "venice/kimi-k2-6",
  "venice/deepseek-v3.2",
  "venice/qwen-3-6-plus",
  "venice/venice-uncensored-1-2",
  "venice/llama-3.3-70b",
  "venice/minimax-m27",
] as const;

export type ModelId =
  | "gpt-4o"
  | "gpt-4o-mini"
  | "claude-sonnet-4"
  | "claude-haiku-4-5"
  | (typeof VENICE_MODELS)[number];

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
  if (model.startsWith("venice/")) return "venice";
  if (model.startsWith("gpt-")) return "openai";
  return "anthropic";
}

function veniceModelId(model: ModelId): string {
  return model.replace(/^venice\//, "");
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
  } else if (provider === "venice") {
    if (!venice) throw new Error("VENICE_API_KEY not configured");
    const response = await venice.chat.completions.create({
      model: veniceModelId(model),
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

  if (provider === "openai" || provider === "venice") {
    const client = provider === "venice" ? venice : openai;
    if (!client) throw new Error("VENICE_API_KEY not configured");
    const stream = await client.chat.completions.create({
      model: provider === "venice" ? veniceModelId(model) : model,
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
