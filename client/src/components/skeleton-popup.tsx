import { useState, useRef, useEffect } from "react";
import { X, Download, Send, GripHorizontal, Minus, Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { downloadText } from "@/lib/streaming";

interface SkeletonData {
  thesis: string;
  outline: string[];
  commitments: string[];
  keyTerms: Record<string, string>;
  databaseContent?: {
    positions: string[];
    quotes: string[];
    arguments: string[];
    works: string[];
  };
}

interface SkeletonPopupProps {
  isOpen: boolean;
  onClose: () => void;
  skeleton: SkeletonData | null;
  onFeedback: (feedback: string) => void;
  onProceed: () => void;
  isLoading?: boolean;
}

export function SkeletonPopup({
  isOpen,
  onClose,
  skeleton,
  onFeedback,
  onProceed,
  isLoading = false,
}: SkeletonPopupProps) {
  const [isMinimized, setIsMinimized] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [position, setPosition] = useState({ x: 50, y: 50 });
  const [size, setSize] = useState({ width: 600, height: 500 });
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [feedback, setFeedback] = useState("");
  const popupRef = useRef<HTMLDivElement>(null);

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

  const handleDownload = async () => {
    if (!skeleton) return;
    let text = "SKELETON\n========\n\n";
    text += `THESIS:\n${skeleton.thesis}\n\n`;
    text += `OUTLINE:\n${skeleton.outline.map((s, i) => `  ${i + 1}. ${s}`).join("\n")}\n\n`;
    if (skeleton.commitments?.length > 0) {
      text += `COMMITMENTS:\n${skeleton.commitments.map((c, i) => `  ${i + 1}. ${c}`).join("\n")}\n\n`;
    }
    if (skeleton.keyTerms && Object.keys(skeleton.keyTerms).length > 0) {
      text += `KEY TERMS:\n${Object.entries(skeleton.keyTerms).map(([k, v]) => `  - ${k}: ${v}`).join("\n")}\n\n`;
    }
    await downloadText(text, `skeleton-${Date.now()}.txt`);
  };

  const handleSendFeedback = () => {
    if (feedback.trim()) {
      onFeedback(feedback.trim());
      setFeedback("");
    }
  };

  if (!isOpen || !skeleton) return null;

  const popupStyle = isMaximized
    ? { top: 0, left: 0, right: 0, bottom: 0, width: "100%", height: "100%" }
    : { top: position.y, left: position.x, width: size.width, height: isMinimized ? "auto" : size.height };

  return (
    <div
      ref={popupRef}
      className="fixed z-50 bg-card border-2 border-secondary rounded-lg shadow-2xl flex flex-col overflow-hidden"
      style={popupStyle}
      data-testid="skeleton-popup"
    >
      <div
        className="flex items-center justify-between px-3 py-2 bg-gradient-to-r from-secondary to-accent cursor-move select-none"
        onMouseDown={handleDragStart}
        data-testid="skeleton-popup-header"
      >
        <div className="flex items-center gap-2 text-white">
          <GripHorizontal className="h-4 w-4 opacity-60" />
          <span className="font-bold text-sm" data-testid="text-skeleton-title">SKELETON - Database Foundation</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="text-white"
            onClick={() => setIsMinimized(!isMinimized)}
            data-testid="button-minimize-skeleton"
          >
            <Minus className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-white"
            onClick={() => setIsMaximized(!isMaximized)}
            data-testid="button-maximize-skeleton"
          >
            {isMaximized ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-white"
            onClick={onClose}
            data-testid="button-close-skeleton"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {!isMinimized && (
        <>
          <div className="flex-1 overflow-auto p-4 bg-background space-y-4" data-testid="skeleton-content">
            {skeleton.thesis && (
              <div className="bg-muted/50 rounded-lg p-3 border border-border">
                <h4 className="font-bold text-sm text-primary mb-2">THESIS</h4>
                <p className="text-sm" data-testid="text-skeleton-thesis">{skeleton.thesis}</p>
              </div>
            )}

            {skeleton.outline && skeleton.outline.length > 0 && (
              <div className="bg-muted/50 rounded-lg p-3 border border-border">
                <h4 className="font-bold text-sm text-primary mb-2">OUTLINE</h4>
                <ol className="list-decimal list-inside text-sm space-y-1" data-testid="list-skeleton-outline">
                  {skeleton.outline.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ol>
              </div>
            )}

            {skeleton.commitments?.length > 0 && (
              <div className="bg-muted/50 rounded-lg p-3 border border-border">
                <h4 className="font-bold text-sm text-primary mb-2">COMMITMENTS</h4>
                <ul className="list-disc list-inside text-sm space-y-1" data-testid="list-skeleton-commitments">
                  {skeleton.commitments.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </div>
            )}

            {skeleton.keyTerms && Object.keys(skeleton.keyTerms).length > 0 && (
              <div className="bg-muted/50 rounded-lg p-3 border border-border">
                <h4 className="font-bold text-sm text-primary mb-2">KEY TERMS</h4>
                <dl className="text-sm space-y-1" data-testid="list-skeleton-terms">
                  {Object.entries(skeleton.keyTerms).map(([term, def]) => (
                    <div key={term}>
                      <dt className="font-medium inline">{term}:</dt>
                      <dd className="inline ml-1 text-muted-foreground">{def}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}

            {skeleton.databaseContent && (
              <div className="bg-muted/50 rounded-lg p-3 border border-border">
                <h4 className="font-bold text-sm text-primary mb-2">DATABASE ITEMS</h4>
                <div className="grid grid-cols-2 gap-2 text-sm" data-testid="skeleton-db-counts">
                  <div>Positions: {skeleton.databaseContent.positions?.length || 0}</div>
                  <div>Quotes: {skeleton.databaseContent.quotes?.length || 0}</div>
                  <div>Arguments: {skeleton.databaseContent.arguments?.length || 0}</div>
                  <div>Works: {skeleton.databaseContent.works?.length || 0}</div>
                </div>
              </div>
            )}

            <div className="border-t border-border pt-4">
              <h4 className="font-bold text-sm text-primary mb-2">FEEDBACK (Optional)</h4>
              <p className="text-xs text-muted-foreground mb-2">
                Tell us what's wrong with this skeleton. We'll regenerate it.
              </p>
              <div className="flex gap-2">
                <Textarea
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  placeholder="This skeleton is missing... / The thesis should focus on... / Add more about..."
                  className="min-h-[60px] text-sm"
                  disabled={isLoading}
                  data-testid="input-skeleton-feedback"
                />
                <Button
                  onClick={handleSendFeedback}
                  disabled={!feedback.trim() || isLoading}
                  size="icon"
                  data-testid="button-send-feedback"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between px-3 py-2 border-t border-border bg-muted/50">
            <Button variant="outline" size="sm" onClick={handleDownload} data-testid="button-download-skeleton">
              <Download className="h-3 w-3 mr-1" /> Download Skeleton
            </Button>
            {isLoading ? (
              <div className="flex items-center gap-2 text-sm text-primary font-medium animate-pulse">
                <span className="inline-block w-2 h-2 bg-primary rounded-full animate-bounce" />
                Generating content...
              </div>
            ) : (
              <Button variant="ghost" size="sm" onClick={onClose} data-testid="button-close-skeleton-done">
                Close
              </Button>
            )}
          </div>

          {!isMaximized && (
            <div
              className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
              onMouseDown={handleResizeStart}
              data-testid="skeleton-resize-handle"
              style={{
                background: "linear-gradient(135deg, transparent 50%, hsl(var(--secondary)) 50%)",
                borderRadius: "0 0 0.5rem 0",
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
