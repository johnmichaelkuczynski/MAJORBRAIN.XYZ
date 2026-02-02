import { useState } from "react";
import { Play, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SectionHeader } from "./section-header";
import { ThinkerSelect } from "./thinker-select";
import { GenerationControls } from "./generation-controls";
import { StreamingOutput } from "./streaming-output";
import { FileUpload } from "./file-upload";
import { downloadText, copyToClipboard } from "@/lib/streaming";

export function ArgumentGeneratorSection() {
  const [topic, setTopic] = useState("");
  const [documentContent, setDocumentContent] = useState("");
  const [thinker, setThinker] = useState("");
  const [argumentType, setArgumentType] = useState<string>("deductive");
  const [output, setOutput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [wordCount, setWordCount] = useState(2000);
  const [quoteCount, setQuoteCount] = useState(10);
  const [enhanced, setEnhanced] = useState(true);

  const handleFileContent = (content: string, fileName: string) => {
    setDocumentContent(content);
    if (!topic.trim()) {
      setTopic(`Find arguments related to: ${fileName}`);
    }
  };

  const handleGenerate = async () => {
    if (!topic.trim() || !thinker || isLoading) return;

    setIsLoading(true);
    setOutput("");

    try {
      const fullTopic = documentContent ? `${topic}\n\n--- DOCUMENT CONTEXT ---\n${documentContent}` : topic;
      const response = await fetch("/api/arguments/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: fullTopic.trim(), thinker, argumentType, wordCount, quoteCount, enhanced }),
      });

      if (!response.ok) throw new Error("Failed to generate arguments");

      const data = await response.json();
      
      if (data.arguments) {
        setOutput(data.arguments.map((arg: any, i: number) => {
          let text = `ARGUMENT ${i + 1}:\n`;
          if (arg.premises) {
            text += `Premises:\n${arg.premises.map((p: string, j: number) => `  ${j + 1}. ${p}`).join("\n")}\n`;
          }
          if (arg.conclusion) {
            text += `Conclusion: ${arg.conclusion}`;
          }
          return text;
        }).join("\n\n---\n\n"));
      } else {
        setOutput(JSON.stringify(data, null, 2));
      }
    } catch (error) {
      console.error("Argument generation error:", error);
      setOutput("Error generating arguments. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleClear = () => { setTopic(""); setDocumentContent(""); setThinker(""); setOutput(""); };
  const handleCopy = () => { copyToClipboard(output); };
  const handleDownload = () => { downloadText(output, `arguments-${thinker}-${Date.now()}.txt`); };

  return (
    <Card className="p-6">
      <SectionHeader
        title="Argument Generator"
        subtitle="Retrieve and format arguments from the database"
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
              placeholder="Enter an argument topic to search for, or describe what arguments you're looking for..."
              className="min-h-[150px] text-base"
              data-testid="input-argument-topic" 
            />
            {documentContent && (
              <p className="text-xs text-muted-foreground mt-1">Document context: {documentContent.split(/\s+/).length.toLocaleString()} words</p>
            )}
          </div>

          <div>
            <Label className="mb-2 block">Thinker</Label>
            <ThinkerSelect value={thinker} onChange={setThinker} className="w-full" placeholder="Select a thinker..." />
          </div>

          <div>
            <Label className="mb-2 block">Argument Type</Label>
            <Select value={argumentType} onValueChange={setArgumentType}>
              <SelectTrigger data-testid="select-argument-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="deductive">Deductive</SelectItem>
                <SelectItem value="inductive">Inductive</SelectItem>
                <SelectItem value="abductive">Abductive</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <GenerationControls wordCount={wordCount} onWordCountChange={setWordCount} quoteCount={quoteCount} onQuoteCountChange={setQuoteCount} enhanced={enhanced} onEnhancedChange={setEnhanced} />

          <Button onClick={handleGenerate} disabled={!topic.trim() || !thinker || isLoading} className="w-full" data-testid="button-generate-arguments">
            {isLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Searching...</> : <><Play className="mr-2 h-4 w-4" />Get Arguments</>}
          </Button>
        </div>

        <div>
          <Label className="mb-2 block">Arguments</Label>
          <StreamingOutput content={output} isStreaming={isLoading} placeholder="Arguments will appear here..." />
        </div>
      </div>
    </Card>
  );
}
