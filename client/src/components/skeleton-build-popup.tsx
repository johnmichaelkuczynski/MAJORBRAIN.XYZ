import { useState, useRef, useEffect } from "react";
import { X, Download, GripHorizontal, Minus, Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadText } from "@/lib/streaming";
import { ThinkerAvatar } from "./thinker-avatar";

interface SkeletonBuildPopupProps {
  isOpen: boolean;
  onClose: () => void;
  content: string;
  isBuilding: boolean;
  thinkerId?: string;
  thinkerName?: string;
}

export function SkeletonBuildPopup({
  isOpen,
  onClose,
  content,
  isBuilding,
  thinkerId,
  thinkerName,
}: SkeletonBuildPopupProps) {
  const [isMinimized, setIsMinimized] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [position, setPosition] = useState({ x: 100, y: 100 });
  const [size, setSize] = useState({ width: 500, height: 400 });
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [content]);

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
          width: Math.max(350, e.clientX - position.x),
          height: Math.max(250, e.clientY - position.y),
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

  const handleDownload = () => {
    downloadText(content, `skeleton-${Date.now()}.txt`);
  };

  if (!isOpen) return null;

  const popupStyle = isMaximized
    ? { top: 0, left: 0, right: 0, bottom: 0, width: "100%", height: "100%" }
    : { top: position.y, left: position.x, width: size.width, height: isMinimized ? "auto" : size.height };

  return (
    <div
      className="fixed z-40 bg-card border-2 border-amber-500 rounded-lg shadow-2xl flex flex-col overflow-hidden"
      style={popupStyle}
      data-testid="skeleton-build-popup"
    >
      <div
        className="flex items-center justify-between px-3 py-2 bg-gradient-to-r from-amber-500 to-orange-500 cursor-move select-none"
        onMouseDown={handleDragStart}
        data-testid="skeleton-build-header"
      >
        <div className="flex items-center gap-2 text-white">
          <GripHorizontal className="h-4 w-4 opacity-60" />
          {thinkerId && (
            <ThinkerAvatar 
              thinkerId={thinkerId} 
              name={thinkerName} 
              size="sm" 
              isAnimating={isBuilding}
              showName={false}
            />
          )}
          <span className="font-bold text-sm" data-testid="text-skeleton-build-title">
            SKELETON - Phase 1
          </span>
          {isBuilding && (
            <span className="ml-2 px-2 py-0.5 text-xs bg-white/20 rounded-full animate-pulse" data-testid="status-building">
              BUILDING...
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="text-white"
            onClick={() => setIsMinimized(!isMinimized)}
            data-testid="button-minimize-skeleton-build"
          >
            <Minus className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-white"
            onClick={() => setIsMaximized(!isMaximized)}
            data-testid="button-maximize-skeleton-build"
          >
            {isMaximized ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-white"
            onClick={onClose}
            data-testid="button-close-skeleton-build"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {!isMinimized && (
        <>
          <div 
            ref={contentRef}
            className="flex-1 overflow-auto p-4 bg-amber-50 dark:bg-amber-950/20 text-sm whitespace-pre-wrap leading-relaxed"
            data-testid="skeleton-build-content"
          >
            {content ? (
              content
                .replace(/\[SKELETON_COMPLETE\]/g, '')
                .replace(/Building skeleton from database\.\.\.\n?/g, '')
                .trim()
            ) : (
              <span className="text-amber-600 animate-pulse">
                Extracting skeleton from database...
              </span>
            )}
            {isBuilding && <span className="inline-block w-2 h-4 bg-amber-500 animate-pulse ml-1" />}
          </div>

          <div className="flex items-center justify-between px-3 py-2 border-t border-amber-300 bg-amber-100/50 dark:bg-amber-900/20">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={handleDownload}
              className="border-amber-500 text-amber-700 hover:bg-amber-100"
              data-testid="button-download-skeleton-build"
            >
              <Download className="h-3 w-3 mr-1" /> Download
            </Button>
            <span className="text-xs text-amber-600" data-testid="text-skeleton-status">
              {isBuilding ? "Extracting database content..." : "Skeleton complete"}
            </span>
          </div>

          {!isMaximized && (
            <div
              className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
              onMouseDown={handleResizeStart}
              data-testid="skeleton-build-resize-handle"
              style={{
                background: "linear-gradient(135deg, transparent 50%, rgb(245 158 11) 50%)",
                borderRadius: "0 0 0.5rem 0",
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
