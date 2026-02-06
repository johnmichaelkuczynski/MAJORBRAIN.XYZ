import { useEffect, useRef, useMemo } from "react";
import { Loader2 } from "lucide-react";

interface StreamingOutputProps {
  content: string;
  isStreaming: boolean;
  placeholder?: string;
  className?: string;
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function StreamingOutput({ 
  content, 
  isStreaming, 
  placeholder = "Output will appear here...",
  className = ""
}: StreamingOutputProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const wordCount = useMemo(() => countWords(content), [content]);

  useEffect(() => {
    if (containerRef.current && isStreaming) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [content, isStreaming]);

  return (
    <div 
      ref={containerRef}
      className={`min-h-[300px] max-h-[600px] overflow-y-auto rounded-md border bg-muted/30 p-4 font-mono text-sm ${className}`}
    >
      {content ? (
        <>
          <div className="sticky top-0 z-10 mb-3 pb-2 border-b border-border/50 bg-muted/30 backdrop-blur-sm" data-testid="text-word-count">
            <span className="font-bold text-foreground text-base">
              Word Count: {wordCount.toLocaleString()}
            </span>
            {isStreaming && (
              <span className="ml-2 text-xs text-muted-foreground">(streaming...)</span>
            )}
          </div>
          <div className="whitespace-pre-wrap">
            {content}
            {isStreaming && (
              <span className="inline-block w-2 h-4 bg-primary animate-pulse ml-1" />
            )}
          </div>
        </>
      ) : isStreaming ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Generating...</span>
        </div>
      ) : (
        <span className="text-muted-foreground">{placeholder}</span>
      )}
    </div>
  );
}
