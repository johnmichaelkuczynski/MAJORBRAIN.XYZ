import { useState } from "react";
import { Play, Loader2 } from "lucide-react";
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

export function OutlineGeneratorSection() {
  const [topic, setTopic] = useState("");
  const [documentContent, setDocumentContent] = useState("");
  const [thinker, setThinker] = useState("");
  const [selectedModel, setSelectedModel] = useState("gpt-4o");
  const [output, setOutput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [wordCount, setWordCount] = useState(2000);
  const [quoteCount, setQuoteCount] = useState(10);
  const [enhanced, setEnhanced] = useState(true);

  const handleFileContent = (content: string, fileName: string) => {
    setDocumentContent(content);
    if (!topic.trim()) {
      setTopic(`Outline for: ${fileName}`);
    }
  };

  const handleGenerate = async () => {
    if (!topic.trim() || !thinker || isStreaming) return;

    setIsStreaming(true);
    setOutput("");

    try {
      const fullTopic = documentContent ? `${topic}\n\n--- DOCUMENT TO OUTLINE ---\n${documentContent}` : topic;
      const response = await fetch("/api/outline/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: fullTopic.trim(), thinker, wordCount, quoteCount, enhanced, model: selectedModel }),
      });

      if (!response.ok) throw new Error("Failed to generate outline");

      for await (const chunk of streamResponseSimple(response)) {
        setOutput(prev => prev + chunk);
      }
    } catch (error) {
      console.error("Outline generation error:", error);
      setOutput("Error generating outline. Please try again.");
    } finally {
      setIsStreaming(false);
    }
  };

  const handleClear = () => { setTopic(""); setDocumentContent(""); setThinker(""); setOutput(""); };
  const handleCopy = () => { copyToClipboard(output); };
  const handleDownload = async () => {
    const topicSlug = topic.trim().split(/\s+/).slice(0, 3).join("_").replace(/[^a-zA-Z0-9_]/g, "").toUpperCase() || "GENERAL";
    const thinkerName = thinker.charAt(0).toUpperCase() + thinker.slice(1).toLowerCase();
    await downloadText(output, `${thinkerName}_OUTLINES_${topicSlug}.txt`);
  };

  return (
    <Card className="p-6">
      <SectionHeader
        title="Outline Generator"
        subtitle="Generate structured outlines (up to 100,000 words)"
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
              placeholder="Enter the topic for the outline or instructions for outlining the uploaded document..."
              className="min-h-[200px] text-base"
              data-testid="input-outline-topic" 
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

          <Button onClick={handleGenerate} disabled={!topic.trim() || !thinker || isStreaming} className="w-full" data-testid="button-generate-outline">
            {isStreaming ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Generating...</> : <><Play className="mr-2 h-4 w-4" />Generate Outline</>}
          </Button>
        </div>

        <div>
          <Label className="mb-2 block">Outline</Label>
          <StreamingOutput content={output} isStreaming={isStreaming} placeholder="Outline will appear here..." />
        </div>
      </div>
    </Card>
  );
}
