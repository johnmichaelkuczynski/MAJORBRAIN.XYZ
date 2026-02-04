import { useState, useRef, useEffect } from "react";
import { X, Minus, Maximize2, Minimize2, Copy, Download, GripHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadText, copyToClipboard } from "@/lib/streaming";
import { ThinkerAvatar } from "./thinker-avatar";

interface StreamingPopupProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  content: string;
  isStreaming: boolean;
  targetWordCount?: number;
  thinkerId?: string;
  thinkerName?: string;
}

export function StreamingPopup({
  isOpen,
  onClose,
  title,
  content,
  isStreaming,
  targetWordCount = 0,
  thinkerId,
  thinkerName,
}: StreamingPopupProps) {
  const [isMinimized, setIsMinimized] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [position, setPosition] = useState({ x: 150, y: 80 });
  const [size, setSize] = useState({ width: 750, height: 550 });
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const contentRef = useRef<HTMLDivElement>(null);

  const wordCount = content.split(/\s+/).filter(w => w).length;
  const progress = targetWordCount > 0 ? Math.min(100, (wordCount / targetWordCount) * 100) : 0;

  useEffect(() => {
    if (contentRef.current && isStreaming) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [content, isStreaming]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        setPosition({
          x: Math.max(0, e.clientX - dragOffset.x),
          y: Math.max(0, e.clientY - dragOffset.y),
        });
      }
      if (isResizing) {
        setSize({
          width: Math.max(400, e.clientX - position.x),
          height: Math.max(300, e.clientY - position.y),
        });
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setIsResizing(false);
    };

    if (isDragging || isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, isResizing, dragOffset, position]);

  const handleDragStart = (e: React.MouseEvent) => {
    if (isMaximized) return;
    setIsDragging(true);
    setDragOffset({
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    });
  };

  const handleResizeStart = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isMaximized) return;
    setIsResizing(true);
  };

  const handleCopy = () => {
    copyToClipboard(content);
  };

  const handleDownload = () => {
    downloadText(content, `output-${Date.now()}.txt`);
  };

  if (!isOpen) return null;

  const popupStyle = isMaximized
    ? { top: 0, left: 0, right: 0, bottom: 0, width: "100%", height: "100%" }
    : { top: position.y, left: position.x, width: size.width, height: isMinimized ? "auto" : size.height };

  return (
    <div
      className="fixed z-50 bg-card border-2 border-primary rounded-lg shadow-2xl flex flex-col overflow-hidden"
      style={popupStyle}
      data-testid="streaming-popup"
    >
      <div
        className="flex items-center justify-between px-3 py-2 bg-gradient-to-r from-primary to-accent cursor-move select-none"
        onMouseDown={handleDragStart}
        data-testid="popup-header"
      >
        <div className="flex items-center gap-2 text-white">
          <GripHorizontal className="h-4 w-4 opacity-60" />
          {thinkerId && (
            <ThinkerAvatar 
              thinkerId={thinkerId} 
              name={thinkerName} 
              size="sm" 
              isAnimating={isStreaming}
              showName={false}
            />
          )}
          <span className="font-bold text-sm" data-testid="text-popup-title">{title}</span>
          {isStreaming && (
            <span className="ml-2 px-2 py-0.5 text-xs bg-white/20 rounded-full animate-pulse" data-testid="status-streaming">
              STREAMING...
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="text-white"
            onClick={() => setIsMinimized(!isMinimized)}
            data-testid="button-minimize-popup"
          >
            <Minus className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-white"
            onClick={() => setIsMaximized(!isMaximized)}
            data-testid="button-maximize-popup"
          >
            {isMaximized ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-white"
            onClick={onClose}
            data-testid="button-close-popup"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {targetWordCount > 0 && !isMinimized && (
        <div className="px-3 py-1 bg-muted/50 border-b border-border">
          <div className="flex items-center justify-between text-xs mb-1">
            <span data-testid="text-word-count">{wordCount.toLocaleString()} / {targetWordCount.toLocaleString()} words</span>
            <span data-testid="text-progress-percent">{Math.round(progress)}%</span>
          </div>
          <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-secondary to-primary transition-all duration-300"
              style={{ width: `${progress}%` }}
              data-testid="progress-bar"
            />
          </div>
        </div>
      )}

      {!isMinimized && (
        <>
          <div
            ref={contentRef}
            className="flex-1 overflow-auto p-4 font-serif text-base leading-relaxed whitespace-pre-wrap bg-background"
            data-testid="popup-content"
          >
            {content || (
              <span className="text-muted-foreground italic">Waiting for content to stream...</span>
            )}
            {isStreaming && (
              <span className="inline-block w-2 h-5 bg-primary animate-pulse ml-1" data-testid="cursor-streaming" />
            )}
          </div>

          <div className="flex items-center justify-between px-3 py-2 border-t border-border bg-muted/50">
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleCopy} disabled={!content} data-testid="button-copy-output">
                <Copy className="h-3 w-3 mr-1" /> Copy
              </Button>
              <Button variant="outline" size="sm" onClick={handleDownload} disabled={!content} data-testid="button-download-output">
                <Download className="h-3 w-3 mr-1" /> Download
              </Button>
            </div>
            <div className="text-xs text-muted-foreground" data-testid="text-final-word-count">
              {wordCount.toLocaleString()} words
            </div>
          </div>

          {!isMaximized && (
            <div
              className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
              onMouseDown={handleResizeStart}
              data-testid="resize-handle"
              style={{
                background: "linear-gradient(135deg, transparent 50%, hsl(var(--primary)) 50%)",
                borderRadius: "0 0 0.5rem 0",
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
