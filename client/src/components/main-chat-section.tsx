import { useState, useRef } from "react";
import { Send, Loader2, Trash2, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { ThinkerSelect } from "./thinker-select";
import { ModelSelect } from "./model-select";
import { GenerationControls } from "./generation-controls";
import { FileUpload } from "./file-upload";
import { ThinkerAvatar } from "./thinker-avatar";
import { SkeletonPopup } from "./skeleton-popup";
import { StreamingPopup } from "./streaming-popup";
import { streamResponse } from "@/lib/streaming";
import { useToast } from "@/hooks/use-toast";
import { THINKERS } from "@shared/schema";

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

export function MainChatSection() {
  const [selectedThinker, setSelectedThinker] = useState("kuczynski");
  const [selectedModel, setSelectedModel] = useState("gpt-4o");
  const [input, setInput] = useState("");
  const [documentContent, setDocumentContent] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [wordCount, setWordCount] = useState(2000);
  const [quoteCount, setQuoteCount] = useState(10);
  const [enhanced, setEnhanced] = useState(true);
  
  const [showSkeletonPopup, setShowSkeletonPopup] = useState(false);
  const [showOutputPopup, setShowOutputPopup] = useState(false);
  const [skeleton, setSkeleton] = useState<SkeletonData | null>(null);
  const [streamingContent, setStreamingContent] = useState("");
  const [pendingMessage, setPendingMessage] = useState("");
  
  const abortControllerRef = useRef<AbortController | null>(null);
  const { toast } = useToast();

  const thinker = THINKERS.find(t => t.id === selectedThinker);

  const handleFileContent = (content: string, fileName: string) => {
    setDocumentContent(content);
    if (!input.trim()) {
      setInput(`Please discuss and analyze this document: ${fileName}`);
    }
    toast({ title: "Document Loaded", description: `${content.split(/\s+/).length.toLocaleString()} words loaded` });
  };

  const handleSubmit = async () => {
    if (!input.trim() || isStreaming) return;

    const userMessage = documentContent 
      ? `${input.trim()}\n\n--- DOCUMENT TO DISCUSS ---\n${documentContent}` 
      : input.trim();
    
    setPendingMessage(userMessage);
    setIsStreaming(true);
    setStreamingContent("");
    
    // Always stream directly - skeleton popup is optional viewing
    setShowOutputPopup(true);
    await streamContent(userMessage);
  };

  const fetchSkeletonAndShow = async (message: string) => {
    try {
      const response = await fetch(`/api/figures/${selectedThinker}/skeleton`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: message, quoteCount }),
      });
      
      if (!response.ok) throw new Error("Failed to fetch skeleton");
      const data = await response.json();
      
      setSkeleton(data.skeleton);
      setShowSkeletonPopup(true);
      
      // Auto-proceed immediately - don't wait for user approval
      // User can still view and download skeleton, or close popup
      setShowOutputPopup(true);
      await generateWithSkeleton(message);
    } catch (error) {
      console.error("Skeleton error:", error);
      toast({ title: "Error", description: "Failed to generate skeleton. Proceeding directly.", variant: "destructive" });
      await generateDirectly(message);
    }
  };

  const handleSkeletonFeedback = async (feedback: string) => {
    setIsStreaming(true);
    try {
      const response = await fetch(`/api/figures/${selectedThinker}/skeleton`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          topic: pendingMessage, 
          quoteCount,
          feedback 
        }),
      });
      
      if (!response.ok) throw new Error("Failed to regenerate skeleton");
      const data = await response.json();
      setSkeleton(data.skeleton);
      toast({ title: "Skeleton Regenerated", description: "Updated based on your feedback" });
    } catch (error) {
      toast({ title: "Error", description: "Failed to regenerate skeleton", variant: "destructive" });
    } finally {
      setIsStreaming(false);
    }
  };

  const handleProceedFromSkeleton = async () => {
    setShowSkeletonPopup(false);
    setShowOutputPopup(true);
    await generateWithSkeleton(pendingMessage);
  };

  const generateDirectly = async (message: string) => {
    setShowOutputPopup(true);
    await streamContent(message);
  };

  const generateWithSkeleton = async (message: string) => {
    await streamContent(message);
  };

  const streamContent = async (message: string) => {
    setIsStreaming(true);
    setStreamingContent("");
    setInput("");
    setDocumentContent("");

    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch(`/api/figures/${selectedThinker}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          message,
          model: selectedModel,
          wordCount,
          quoteCount,
          enhanced
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) throw new Error("Failed to get response");

      let content = "";
      for await (const chunk of streamResponse(response)) {
        content += chunk;
        setStreamingContent(content);
      }
    } catch (error: any) {
      if (error.name !== "AbortError") {
        console.error("Chat error:", error);
        toast({ title: "Error", description: "Failed to generate response", variant: "destructive" });
      }
    } finally {
      setIsStreaming(false);
    }
  };

  const handleClear = () => {
    setInput("");
    setDocumentContent("");
    setStreamingContent("");
    setSkeleton(null);
    setShowSkeletonPopup(false);
    setShowOutputPopup(false);
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  return (
    <>
      <Card className="p-6 border-2 border-primary/20 shadow-lg">
        <div className="flex items-center gap-4 mb-6">
          <ThinkerAvatar 
            thinkerId={selectedThinker} 
            name={thinker?.name}
            size="xl" 
            isAnimating={isStreaming}
            showName={true}
          />
          <div className="flex-1">
            <h2 className="text-2xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent flex items-center gap-2">
              <MessageSquare className="h-6 w-6 text-primary" />
              Ask {thinker?.name || "a Thinker"}
            </h2>
            <p className="text-sm text-muted-foreground">
              Engage in philosophical dialogue grounded in actual writings
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={handleClear} disabled={isStreaming}>
            <Trash2 className="h-4 w-4 mr-1" /> Clear
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <ThinkerSelect value={selectedThinker} onChange={setSelectedThinker} className="w-full" />
          <ModelSelect value={selectedModel} onChange={setSelectedModel} className="w-full" />
        </div>

        <GenerationControls
          wordCount={wordCount}
          onWordCountChange={setWordCount}
          quoteCount={quoteCount}
          onQuoteCountChange={setQuoteCount}
          enhanced={enhanced}
          onEnhancedChange={setEnhanced}
        />

        <div className="space-y-4 mt-4">
          <div>
            <Label className="mb-2 block text-sm font-medium">Upload Document (Optional)</Label>
            <FileUpload onFileContent={handleFileContent} disabled={isStreaming} />
            {documentContent && (
              <p className="text-xs text-secondary mt-1 font-medium">
                Document loaded: {documentContent.split(/\s+/).length.toLocaleString()} words
              </p>
            )}
          </div>

          <div className="flex gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={`Ask ${thinker?.name || "a thinker"} a question...`}
              className="min-h-[120px] text-base border-2 focus:border-primary"
              disabled={isStreaming}
              data-testid="input-chat-message"
            />
            <Button 
              onClick={handleSubmit} 
              disabled={!input.trim() || isStreaming} 
              className="min-h-[120px] w-20 bg-gradient-to-b from-primary to-accent hover:from-primary/90 hover:to-accent/90"
              data-testid="button-send-message"
            >
              {isStreaming ? (
                <Loader2 className="h-6 w-6 animate-spin" />
              ) : (
                <Send className="h-6 w-6" />
              )}
            </Button>
          </div>
        </div>
      </Card>

      <SkeletonPopup
        isOpen={showSkeletonPopup}
        onClose={() => {
          setShowSkeletonPopup(false);
          setIsStreaming(false);
        }}
        skeleton={skeleton}
        onFeedback={handleSkeletonFeedback}
        onProceed={handleProceedFromSkeleton}
        isLoading={isStreaming}
      />

      <StreamingPopup
        isOpen={showOutputPopup}
        onClose={() => {
          setShowOutputPopup(false);
          if (abortControllerRef.current) {
            abortControllerRef.current.abort();
          }
          setIsStreaming(false);
        }}
        title={`Response from ${thinker?.name || "Thinker"}`}
        content={streamingContent}
        isStreaming={isStreaming}
        targetWordCount={wordCount}
        thinkerId={selectedThinker}
        thinkerName={thinker?.name}
      />
    </>
  );
}
