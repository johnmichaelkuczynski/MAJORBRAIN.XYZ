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

export function DialogueCreatorSection() {
  const [topic, setTopic] = useState("");
  const [documentContent, setDocumentContent] = useState("");
  const [selectedThinkers, setSelectedThinkers] = useState<string[]>([]);
  const [currentThinker, setCurrentThinker] = useState("");
  const [wordCount, setWordCount] = useState(2000);
  const [quoteCount, setQuoteCount] = useState(10);
  const [enhanced, setEnhanced] = useState(false);
  const [selectedModel, setSelectedModel] = useState("gpt-4o");
  const [output, setOutput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);

  const addThinker = () => {
    if (currentThinker && !selectedThinkers.includes(currentThinker)) {
      setSelectedThinkers(prev => [...prev, currentThinker]);
      setCurrentThinker("");
    }
  };

  const removeThinker = (id: string) => {
    setSelectedThinkers(prev => prev.filter(t => t !== id));
  };

  const handleFileContent = (content: string, fileName: string) => {
    setDocumentContent(content);
    if (!topic.trim()) {
      setTopic(`Discussion of: ${fileName}`);
    }
  };

  const handleGenerate = async () => {
    if (!topic.trim() || selectedThinkers.length < 2 || isStreaming) return;

    setIsStreaming(true);
    setOutput("");

    try {
      const fullTopic = documentContent ? `${topic}\n\n--- DOCUMENT TO DISCUSS ---\n${documentContent}` : topic;
      const response = await fetch("/api/dialogue/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: fullTopic.trim(), thinkers: selectedThinkers, wordCount, quoteCount, enhanced, model: selectedModel }),
      });

      if (!response.ok) throw new Error("Failed to generate dialogue");

      for await (const chunk of streamResponse(response)) {
        setOutput(prev => prev + chunk);
      }
    } catch (error) {
      console.error("Dialogue error:", error);
      setOutput("Error generating dialogue. Please try again.");
    } finally {
      setIsStreaming(false);
    }
  };

  const handleClear = () => { setTopic(""); setDocumentContent(""); setSelectedThinkers([]); setOutput(""); };
  const handleCopy = () => { copyToClipboard(output); };
  const handleDownload = () => { downloadText(output, `philosophical-dialogue-${Date.now()}.txt`); };

  return (
    <Card className="p-6">
      <SectionHeader
        title="Dialogue Creator"
        subtitle="Generate philosophical dialogues between thinkers (up to 100,000 words)"
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
            <Label className="mb-2 block">Topic / Instructions</Label>
            <Textarea 
              value={topic} 
              onChange={(e) => setTopic(e.target.value)} 
              placeholder="Enter the dialogue topic, questions to explore, or instructions for discussing the uploaded document..."
              className="min-h-[200px] text-base"
              data-testid="input-dialogue-topic" 
            />
            {documentContent && (
              <p className="text-xs text-muted-foreground mt-1">Document loaded: {documentContent.split(/\s+/).length.toLocaleString()} words</p>
            )}
          </div>

          <div>
            <Label className="mb-2 block">Participants (min 2)</Label>
            <div className="flex gap-2 mb-2">
              <ThinkerSelect value={currentThinker} onChange={setCurrentThinker} className="flex-1" placeholder="Add a thinker..." excludeIds={selectedThinkers} />
              <Button onClick={addThinker} disabled={!currentThinker} size="icon" variant="outline" data-testid="button-add-thinker">
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {selectedThinkers.map(id => {
                const thinker = THINKERS.find(t => t.id === id);
                return (
                  <Badge key={id} variant="secondary" className="flex items-center gap-1">
                    {thinker?.name}
                    <button onClick={() => removeThinker(id)} className="ml-1 hover:text-destructive" data-testid={`button-remove-thinker-${id}`}>
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                );
              })}
            </div>
          </div>

          <GenerationControls wordCount={wordCount} onWordCountChange={setWordCount} quoteCount={quoteCount} onQuoteCountChange={setQuoteCount} enhanced={enhanced} onEnhancedChange={setEnhanced} />

          <ModelSelect value={selectedModel} onChange={setSelectedModel} className="w-full" />

          <Button onClick={handleGenerate} disabled={!topic.trim() || selectedThinkers.length < 2 || isStreaming} className="w-full" data-testid="button-generate-dialogue">
            {isStreaming ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Generating...</> : <><Play className="mr-2 h-4 w-4" />Generate Dialogue</>}
          </Button>
        </div>

        <div>
          <Label className="mb-2 block">Output</Label>
          <StreamingOutput content={output} isStreaming={isStreaming} placeholder="Dialogue will appear here..." />
        </div>
      </div>
    </Card>
  );
}
