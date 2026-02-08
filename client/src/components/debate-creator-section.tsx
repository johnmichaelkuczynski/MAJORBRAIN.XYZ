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
import { streamResponseSimple, downloadText, copyToClipboard } from "@/lib/streaming";
import { THINKERS } from "@shared/schema";

const MAX_DEBATER_WORDS = 50000;

function DebaterFileUpload({ debaterId, onContent, content, disabled }: {
  debaterId: string;
  onContent: (content: string, fileName: string) => void;
  content: string;
  disabled: boolean;
}) {
  const thinker = THINKERS.find(t => t.id === debaterId);
  const name = thinker?.name || debaterId;
  const wordCount = content ? content.split(/\s+/).filter(Boolean).length : 0;
  const isOverLimit = wordCount > MAX_DEBATER_WORDS;

  return (
    <div className="space-y-1" data-testid={`debater-upload-${debaterId}`}>
      <Label className="text-sm font-medium flex items-center gap-2">
        <Badge variant="outline" className="text-xs">{name}</Badge>
        Material
      </Label>
      <FileUpload
        onFileContent={(text, fileName) => {
          const words = text.split(/\s+/).filter(Boolean);
          if (words.length > MAX_DEBATER_WORDS) {
            onContent(words.slice(0, MAX_DEBATER_WORDS).join(" "), fileName);
          } else {
            onContent(text, fileName);
          }
        }}
        disabled={disabled}
      />
      {content && (
        <div className="flex items-center justify-between">
          <p className={`text-xs ${isOverLimit ? "text-destructive" : "text-muted-foreground"}`}>
            {wordCount.toLocaleString()} / {MAX_DEBATER_WORDS.toLocaleString()} words loaded for {name}
          </p>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onContent("", "")}
            data-testid={`button-clear-debater-doc-${debaterId}`}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      )}
      <Textarea
        value={content}
        onChange={(e) => {
          const text = e.target.value;
          const words = text.split(/\s+/).filter(Boolean);
          if (words.length <= MAX_DEBATER_WORDS) {
            onContent(text, "typed-content");
          }
        }}
        placeholder={`Paste or type material specifically for ${name} to draw from in the debate (up to ${MAX_DEBATER_WORDS.toLocaleString()} words)...`}
        className="min-h-[80px] text-sm"
        disabled={disabled}
        data-testid={`textarea-debater-doc-${debaterId}`}
      />
    </div>
  );
}

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
  const [debaterDocuments, setDebaterDocuments] = useState<Record<string, string>>({});

  const addDebater = () => {
    if (currentDebater && !debaters.includes(currentDebater) && debaters.length < 4) {
      setDebaters(prev => [...prev, currentDebater]);
      setCurrentDebater("");
    }
  };

  const removeDebater = (id: string) => {
    setDebaters(prev => prev.filter(d => d !== id));
    setDebaterDocuments(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const handleFileContent = (content: string, fileName: string) => {
    setDocumentContent(content);
    if (!topic.trim()) {
      setTopic(`Discussion of: ${fileName}`);
    }
  };

  const handleDebaterDocument = (debaterId: string, content: string, _fileName: string) => {
    setDebaterDocuments(prev => ({
      ...prev,
      [debaterId]: content,
    }));
  };

  const handleGenerate = async () => {
    if (!topic.trim() || debaters.length < 2 || isStreaming) return;

    setIsStreaming(true);
    setOutput("");

    try {
      const fullTopic = documentContent ? `${topic}\n\n--- DOCUMENT TO DISCUSS ---\n${documentContent}` : topic;

      const hasDebaterDocs = Object.values(debaterDocuments).some(d => d.trim().length > 0);
      const debaterDocsPayload: Record<string, string> = {};
      if (hasDebaterDocs) {
        for (const [id, doc] of Object.entries(debaterDocuments)) {
          if (doc.trim()) {
            debaterDocsPayload[id] = doc.trim();
          }
        }
      }

      const response = await fetch("/api/debate/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: fullTopic.trim(),
          debaters,
          wordCount,
          quoteCount,
          enhanced,
          model: selectedModel,
          ...(Object.keys(debaterDocsPayload).length > 0 && { debaterDocuments: debaterDocsPayload }),
        }),
      });

      if (!response.ok) throw new Error("Failed to generate debate");

      for await (const chunk of streamResponseSimple(response)) {
        setOutput(prev => prev + chunk);
      }
    } catch (error) {
      console.error("Debate error:", error);
      setOutput("Error generating debate. Please try again.");
    } finally {
      setIsStreaming(false);
    }
  };

  const handleClear = () => { setTopic(""); setDocumentContent(""); setDebaters([]); setDebaterDocuments({}); setOutput(""); };
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
          <div className="border border-dashed border-primary/40 rounded-md p-4 bg-primary/5">
            <Label className="mb-1 block text-base font-semibold">Common Document for Debate</Label>
            <p className="text-xs text-muted-foreground mb-3">
              Upload the document, article, or text that all debaters will discuss and argue about.
              Every participant will reference this shared material.
            </p>
            <FileUpload onFileContent={handleFileContent} disabled={isStreaming} />
            {documentContent && (
              <p className="text-sm text-primary mt-2 font-medium">Document loaded: {documentContent.split(/\s+/).length.toLocaleString()} words</p>
            )}
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

          {debaters.length > 0 && (
            <div className="space-y-3">
              <Label className="block text-sm font-medium">Individual Debater Material (Optional, up to {MAX_DEBATER_WORDS.toLocaleString()} words each)</Label>
              <p className="text-xs text-muted-foreground">
                Upload material specific to one debater only (e.g., that thinker's own writings).
                This is separate from the common document above, which all debaters share.
              </p>
              {debaters.map(id => (
                <DebaterFileUpload
                  key={id}
                  debaterId={id}
                  content={debaterDocuments[id] || ""}
                  onContent={(content, fileName) => handleDebaterDocument(id, content, fileName)}
                  disabled={isStreaming}
                />
              ))}
            </div>
          )}

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
