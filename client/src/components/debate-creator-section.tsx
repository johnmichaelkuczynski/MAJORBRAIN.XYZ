import { useState } from "react";
import { Play, Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { SectionHeader } from "./section-header";
import { ThinkerSelect } from "./thinker-select";
import { ModelSelect } from "./model-select";
import { GenerationControls } from "./generation-controls";
import { StreamingOutput } from "./streaming-output";
import { FileUpload } from "./file-upload";
import { streamResponse, downloadText, copyToClipboard } from "@/lib/streaming";
import { THINKERS } from "@shared/schema";

export function DebateCreatorSection() {
  const [topic, setTopic] = useState("");
  const [documentContent, setDocumentContent] = useState("");
  const [debaters, setDebaters] = useState<string[]>([]);
  const [currentDebater, setCurrentDebater] = useState("");
  const [selectedModel, setSelectedModel] = useState("gpt-4o");
  const [output, setOutput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [wordCount, setWordCount] = useState(2000);
  const [quoteCount, setQuoteCount] = useState(10);
  const [enhanced, setEnhanced] = useState(true);

  const addDebater = () => {
    if (currentDebater && !debaters.includes(currentDebater) && debaters.length < 4) {
      setDebaters(prev => [...prev, currentDebater]);
      setCurrentDebater("");
    }
  };

  const removeDebater = (id: string) => {
    setDebaters(prev => prev.filter(d => d !== id));
  };

  const handleFileContent = (content: string, fileName: string) => {
    setDocumentContent(content);
    if (!topic.trim()) {
      setTopic(`Discussion of: ${fileName}`);
    }
  };

  const handleGenerate = async () => {
    if (!topic.trim() || debaters.length < 2 || isStreaming) return;

    setIsStreaming(true);
    setOutput("");

    try {
      const fullTopic = documentContent ? `${topic}\n\n--- DOCUMENT TO DISCUSS ---\n${documentContent}` : topic;
      const response = await fetch("/api/debate/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: fullTopic.trim(), debaters, wordCount, quoteCount, enhanced, model: selectedModel }),
      });

      if (!response.ok) throw new Error("Failed to generate debate");

      for await (const chunk of streamResponse(response)) {
        setOutput(prev => prev + chunk);
      }
    } catch (error) {
      console.error("Debate error:", error);
      setOutput("Error generating debate. Please try again.");
    } finally {
      setIsStreaming(false);
    }
  };

  const handleClear = () => { setTopic(""); setDocumentContent(""); setDebaters([]); setOutput(""); };
  const handleCopy = () => { copyToClipboard(output); };
  const handleDownload = () => { downloadText(output, `philosophical-debate-${Date.now()}.txt`); };

  return (
    <Card className="p-6">
      <SectionHeader
        title="Debate Creator"
        subtitle="Generate structured debates between philosophers (up to 100,000 words)"
        onClear={handleClear}
        onCopy={handleCopy}
        onDownload={handleDownload}
        hasContent={!!output}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div>
            <Label className="mb-2 block">Upload Document (Optional)</Label>
            <FileUpload onFileContent={handleFileContent} disabled={isStreaming} />
          </div>

          <div>
            <Label className="mb-2 block">Debate Topic / Instructions</Label>
            <Textarea 
              value={topic} 
              onChange={(e) => setTopic(e.target.value)} 
              placeholder="Enter the debate topic, thesis to argue, or instructions for how to discuss the uploaded document..."
              className="min-h-[200px] text-base"
              data-testid="input-debate-topic" 
            />
            {documentContent && (
              <p className="text-xs text-muted-foreground mt-1">Document loaded: {documentContent.split(/\s+/).length.toLocaleString()} words</p>
            )}
          </div>

          <div>
            <Label className="mb-2 block">Debaters (2-4 participants)</Label>
            <div className="flex gap-2 mb-2">
              <ThinkerSelect value={currentDebater} onChange={setCurrentDebater} className="flex-1" placeholder="Add a debater..." excludeIds={debaters} />
              <Button onClick={addDebater} disabled={!currentDebater || debaters.length >= 4} size="icon" variant="outline" data-testid="button-add-debater">
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {debaters.map(id => {
                const thinker = THINKERS.find(t => t.id === id);
                return (
                  <Badge key={id} variant="secondary" className="flex items-center gap-1">
                    {thinker?.name}
                    <button onClick={() => removeDebater(id)} className="ml-1 hover:text-destructive" data-testid={`button-remove-debater-${id}`}>
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                );
              })}
            </div>
          </div>

          <GenerationControls wordCount={wordCount} onWordCountChange={setWordCount} quoteCount={quoteCount} onQuoteCountChange={setQuoteCount} enhanced={enhanced} onEnhancedChange={setEnhanced} />

          <ModelSelect value={selectedModel} onChange={setSelectedModel} className="w-full" />

          <Button onClick={handleGenerate} disabled={!topic.trim() || debaters.length < 2 || isStreaming} className="w-full" data-testid="button-generate-debate">
            {isStreaming ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Generating...</> : <><Play className="mr-2 h-4 w-4" />Generate Debate</>}
          </Button>
        </div>

        <div>
          <Label className="mb-2 block">Output</Label>
          <StreamingOutput content={output} isStreaming={isStreaming} placeholder="Debate will appear here..." />
        </div>
      </div>
    </Card>
  );
}
