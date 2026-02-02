export async function* streamResponse(response: Response): AsyncGenerator<string> {
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
          yield buffer;
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
            if (parsed.content) {
              yield parsed.content;
            } else if (parsed.text) {
              yield parsed.text;
            } else if (typeof parsed === "string") {
              yield parsed;
            }
          } catch {
            // Not JSON, yield raw data
            if (data.trim()) {
              yield data;
            }
          }
        } else if (line.trim() && !line.startsWith(":")) {
          // Plain text line
          yield line;
        }
      }
    }
  } finally {
    reader.releaseLock();
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
