import { useState } from "react";
import { Play, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { SectionHeader } from "./section-header";
import { ThinkerSelect } from "./thinker-select";
import { GenerationControls } from "./generation-controls";
import { StreamingOutput } from "./streaming-output";
import { FileUpload } from "./file-upload";
import { downloadText, copyToClipboard } from "@/lib/streaming";

export function PositionGeneratorSection() {
  const [topic, setTopic] = useState("");
  const [documentContent, setDocumentContent] = useState("");
  const [thinker, setThinker] = useState("");
  const [output, setOutput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [wordCount, setWordCount] = useState(2000);
  const [quoteCount, setQuoteCount] = useState(10);
  const [enhanced, setEnhanced] = useState(true);

  const handleFileContent = (content: string, fileName: string) => {
    setDocumentContent(content);
    if (!topic.trim()) {
      setTopic(`Find positions related to: ${fileName}`);
    }
  };

  const handleGenerate = async () => {
    if (!topic.trim() || !thinker || isLoading) return;

    setIsLoading(true);
    setOutput("");

    try {
      const fullTopic = documentContent ? `${topic}\n\n--- DOCUMENT CONTEXT ---\n${documentContent}` : topic;
      const response = await fetch("/api/positions/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: fullTopic.trim(), thinker, wordCount, quoteCount, enhanced }),
      });

      if (!response.ok) throw new Error("Failed to generate positions");

      const data = await response.json();
      setOutput(data.positions?.map((p: any, i: number) => `${i + 1}. ${p.positionText || p}`).join("\n\n") || JSON.stringify(data, null, 2));
    } catch (error) {
      console.error("Position generation error:", error);
      setOutput("Error generating positions. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleClear = () => { setTopic(""); setDocumentContent(""); setThinker(""); setOutput(""); };
  const handleCopy = () => { copyToClipboard(output); };
  const handleDownload = async () => { await downloadText(output, `positions-${thinker}-${Date.now()}.txt`); };

  return (
    <Card className="p-6">
      <SectionHeader
        title="Position Generator"
        subtitle="Retrieve philosophical positions from the database"
        onClear={handleClear}
        onCopy={handleCopy}
        onDownload={handleDownload}
        hasContent={!!output}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div>
            <Label className="mb-2 block">Upload Document for Context (Optional)</Label>
            <FileUpload onFileContent={handleFileContent} disabled={isLoading} />
          </div>

          <div>
            <Label className="mb-2 block">Topic / Search Query</Label>
            <Textarea 
              value={topic} 
              onChange={(e) => setTopic(e.target.value)} 
              placeholder="Enter a philosophical topic to search for positions, or describe what positions you're looking for..."
              className="min-h-[150px] text-base"
              data-testid="input-position-topic" 
            />
            {documentContent && (
              <p className="text-xs text-muted-foreground mt-1">Document context: {documentContent.split(/\s+/).length.toLocaleString()} words</p>
            )}
          </div>

          <div>
            <Label className="mb-2 block">Thinker</Label>
            <ThinkerSelect value={thinker} onChange={setThinker} className="w-full" placeholder="Select a thinker..." />
          </div>

          <GenerationControls wordCount={wordCount} onWordCountChange={setWordCount} quoteCount={quoteCount} onQuoteCountChange={setQuoteCount} enhanced={enhanced} onEnhancedChange={setEnhanced} />

          <Button onClick={handleGenerate} disabled={!topic.trim() || !thinker || isLoading} className="w-full" data-testid="button-generate-positions">
            {isLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Searching...</> : <><Play className="mr-2 h-4 w-4" />Get Positions</>}
          </Button>
        </div>

        <div>
          <Label className="mb-2 block">Positions</Label>
          <StreamingOutput content={output} isStreaming={isLoading} placeholder="Positions will appear here..." />
        </div>
      </div>
    </Card>
  );
}
