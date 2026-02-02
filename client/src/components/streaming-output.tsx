import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";

interface StreamingOutputProps {
  content: string;
  isStreaming: boolean;
  placeholder?: string;
  className?: string;
}

export function StreamingOutput({ 
  content, 
  isStreaming, 
  placeholder = "Output will appear here...",
  className = ""
}: StreamingOutputProps) {
  const containerRef = useRef<HTMLDivElement>(null);

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
        <div className="whitespace-pre-wrap">
          {content}
          {isStreaming && (
            <span className="inline-block w-2 h-4 bg-primary animate-pulse ml-1" />
          )}
        </div>
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
