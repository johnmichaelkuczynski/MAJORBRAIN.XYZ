export interface StreamChunk {
  type: "skeleton" | "content" | "raw";
  content: string;
}

export async function* streamResponse(response: Response): AsyncGenerator<StreamChunk> {
  if (!response.body) {
    throw new Error("No response body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      
      if (done) {
        if (buffer) {
          yield { type: "raw", content: buffer };
        }
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      
      // Process SSE format: data: ...\n\n
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          if (data === "[DONE]") {
            return;
          }
          try {
            const parsed = JSON.parse(data);
            if (typeof parsed === "string") {
              // Old format: data: "word" - treat as content
              yield { type: "content", content: parsed };
            } else if (parsed.type === "skeleton" && parsed.content) {
              // New format: skeleton channel
              yield { type: "skeleton", content: parsed.content };
            } else if (parsed.type === "content" && parsed.content) {
              // New format: content channel
              yield { type: "content", content: parsed.content };
            } else if (parsed.content) {
              // Legacy format with content field
              yield { type: "content", content: parsed.content };
            } else if (parsed.text) {
              yield { type: "content", content: parsed.text };
            }
          } catch {
            // Not JSON, yield raw data
            if (data.trim()) {
              yield { type: "raw", content: data };
            }
          }
        } else if (line.trim() && !line.startsWith(":")) {
          yield { type: "raw", content: line };
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// Simple string stream for backward compatibility
export async function* streamResponseSimple(response: Response): AsyncGenerator<string> {
  for await (const chunk of streamResponse(response)) {
    yield chunk.content;
  }
}

export function downloadText(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function copyToClipboard(text: string): Promise<void> {
  return navigator.clipboard.writeText(text);
}
