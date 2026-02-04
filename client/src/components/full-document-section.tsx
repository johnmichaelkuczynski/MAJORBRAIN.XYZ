import { useState } from "react";
import { Play, Loader2, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { SectionHeader } from "./section-header";
import { ThinkerSelect } from "./thinker-select";
import { ModelSelect } from "./model-select";
import { GenerationControls } from "./generation-controls";
import { StreamingOutput } from "./streaming-output";
import { FileUpload } from "./file-upload";
import { streamResponseSimple, downloadText, copyToClipboard } from "@/lib/streaming";

export function FullDocumentSection() {
  const [topic, setTopic] = useState("");
  const [documentContent, setDocumentContent] = useState("");
  const [thinker, setThinker] = useState("");
  const [wordCount, setWordCount] = useState(5000);
  const [quoteCount, setQuoteCount] = useState(25);
  const [enhanced, setEnhanced] = useState(true);
  const [selectedModel, setSelectedModel] = useState("gpt-4o");
  const [output, setOutput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [abortController, setAbortController] = useState<AbortController | null>(null);

  const handleFileContent = (content: string, fileName: string) => {
    setDocumentContent(content);
    if (!topic.trim()) {
      setTopic(`Analysis of: ${fileName}`);
    }
  };

  const handleGenerate = async () => {
    if (!topic.trim() || !thinker || isStreaming) return;

    const controller = new AbortController();
    setAbortController(controller);
    setIsStreaming(true);
    setOutput("");

    try {
      const fullTopic = documentContent ? `${topic}\n\n--- DOCUMENT TO ANALYZE ---\n${documentContent}` : topic;
      const response = await fetch("/api/document/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: fullTopic.trim(), thinker, wordCount, quoteCount, enhanced, model: selectedModel }),
        signal: controller.signal
      });

      if (!response.ok) throw new Error("Failed to generate document");

      for await (const chunk of streamResponseSimple(response)) {
        setOutput(prev => prev + chunk);
      }
    } catch (error: any) {
      if (error.name === "AbortError") {
        setOutput(prev => prev + "\n\n[GENERATION HALTED BY USER]");
      } else {
        console.error("Document generation error:", error);
        setOutput("Error generating document. Please try again.");
      }
    } finally {
      setIsStreaming(false);
      setAbortController(null);
    }
  };

  const handleHalt = () => { if (abortController) abortController.abort(); };
  const handleClear = () => { setTopic(""); setDocumentContent(""); setThinker(""); setOutput(""); };
  const handleCopy = () => { copyToClipboard(output); };
  const handleDownload = () => { downloadText(output, `full-document-${thinker}-${Date.now()}.txt`); };

  return (
    <Card className="p-6">
      <SectionHeader
        title="Full Document Generator"
        subtitle="Generate comprehensive philosophical documents (up to 100,000 words)"
        onClear={handleClear}
        onCopy={handleCopy}
        onDownload={handleDownload}
        hasContent={!!output}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div>
            <Label className="mb-2 block">Upload Source Document (Optional)</Label>
            <FileUpload onFileContent={handleFileContent} disabled={isStreaming} />
          </div>

          <div>
            <Label className="mb-2 block">Topic / Instructions</Label>
            <Textarea 
              value={topic} 
              onChange={(e) => setTopic(e.target.value)} 
              placeholder="Enter the document topic, thesis, or detailed instructions for analyzing the uploaded document..."
              className="min-h-[200px] text-base"
              data-testid="input-document-topic" 
            />
            {documentContent && (
              <p className="text-xs text-muted-foreground mt-1">Document loaded: {documentContent.split(/\s+/).length.toLocaleString()} words</p>
            )}
          </div>

          <div>
            <Label className="mb-2 block">Thinker</Label>
            <ThinkerSelect value={thinker} onChange={setThinker} className="w-full" placeholder="Select a thinker..." />
          </div>

          <GenerationControls wordCount={wordCount} onWordCountChange={setWordCount} quoteCount={quoteCount} onQuoteCountChange={setQuoteCount} enhanced={enhanced} onEnhancedChange={setEnhanced} />

          <ModelSelect value={selectedModel} onChange={setSelectedModel} className="w-full" />

          <div className="flex gap-2">
            <Button onClick={handleGenerate} disabled={!topic.trim() || !thinker || isStreaming} className="flex-1" data-testid="button-generate-document">
              {isStreaming ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Generating...</> : <><Play className="mr-2 h-4 w-4" />Generate Document</>}
            </Button>
            {isStreaming && (
              <Button onClick={handleHalt} variant="destructive" data-testid="button-halt-generation">
                <Square className="mr-2 h-4 w-4" /> HALT
              </Button>
            )}
          </div>
        </div>

        <div>
          <Label className="mb-2 block">Document</Label>
          <StreamingOutput content={output} isStreaming={isStreaming} placeholder="Document will appear here..." className="min-h-[400px]" />
        </div>
      </div>
    </Card>
  );
}
