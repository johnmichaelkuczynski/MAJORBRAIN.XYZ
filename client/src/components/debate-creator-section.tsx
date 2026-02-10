import { useState } from "react";
import { Play, Loader2, Plus, X, Download, Copy, FileText } from "lucide-react";
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
import { downloadText, copyToClipboard } from "@/lib/streaming";
import { THINKERS } from "@shared/schema";

const MAX_DEBATER_WORDS = 50000;

interface DebateArtifacts {
  outline: string;
  skeleton: string;
  documentCitations: string;
  debaterContent: string;
  debate: string;
}

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

function ArtifactPanel({ title, content, artifactKey, isStreaming }: {
  title: string;
  content: string;
  artifactKey: string;
  isStreaming?: boolean;
}) {
  if (!content && !isStreaming) return null;

  const wordCount = content ? content.split(/\s+/).filter(Boolean).length : 0;

  return (
    <div className="border rounded-md" data-testid={`artifact-${artifactKey}`}>
      <div className="flex items-center justify-between gap-2 p-3 border-b bg-muted/30">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">{title}</span>
          {content && (
            <Badge variant="outline" className="text-xs">{wordCount.toLocaleString()} words</Badge>
          )}
        </div>
        {content && (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => copyToClipboard(content)}
              data-testid={`button-copy-${artifactKey}`}
            >
              <Copy className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => downloadText(content, `debate-${artifactKey}-${Date.now()}.txt`)}
              data-testid={`button-download-${artifactKey}`}
            >
              <Download className="h-3 w-3" />
            </Button>
          </div>
        )}
      </div>
      <div className="p-3 max-h-[300px] overflow-y-auto">
        {content ? (
          <pre className="text-sm whitespace-pre-wrap font-sans" data-testid={`text-${artifactKey}`}>{content}</pre>
        ) : isStreaming ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Generating...</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function DebateCreatorSection() {
  const [topic, setTopic] = useState("");
  const [documentContent, setDocumentContent] = useState("");
  const [debaters, setDebaters] = useState<string[]>([]);
  const [currentDebater, setCurrentDebater] = useState("");
  const [selectedModel, setSelectedModel] = useState("gpt-4o");
  const [isStreaming, setIsStreaming] = useState(false);
  const [wordCount, setWordCount] = useState(2000);
  const [quoteCount, setQuoteCount] = useState(10);
  const [enhanced, setEnhanced] = useState(true);
  const [debaterDocuments, setDebaterDocuments] = useState<Record<string, string>>({});
  const [artifacts, setArtifacts] = useState<DebateArtifacts>({
    outline: "",
    skeleton: "",
    documentCitations: "",
    debaterContent: "",
    debate: "",
  });

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
    setArtifacts({ outline: "", skeleton: "", documentCitations: "", debaterContent: "", debate: "" });

    try {
      const debaterDocsPayload: Record<string, string> = {};
      for (const [id, doc] of Object.entries(debaterDocuments)) {
        if (doc.trim()) {
          debaterDocsPayload[id] = doc.trim();
        }
      }

      const response = await fetch("/api/debate/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: topic.trim(),
          debaters,
          wordCount,
          quoteCount,
          enhanced,
          model: selectedModel,
          ...(documentContent.trim() && { commonDocument: documentContent.trim() }),
          ...(Object.keys(debaterDocsPayload).length > 0 && { debaterDocuments: debaterDocsPayload }),
        }),
      });

      if (!response.ok) throw new Error("Failed to generate debate");

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const dataStr = line.slice(6).trim();
          if (dataStr === "[DONE]") continue;

          try {
            const parsed = JSON.parse(dataStr);

            if (parsed.artifact) {
              const key = parsed.artifact as keyof DebateArtifacts;
              if (key in artifacts || ["outline", "skeleton", "documentCitations", "debaterContent"].includes(key)) {
                setArtifacts(prev => ({ ...prev, [key]: parsed.content }));
              }
            } else if (parsed.type === "skeleton") {
              setArtifacts(prev => ({ ...prev, skeleton: prev.skeleton + parsed.content }));
            } else if (parsed.type === "content" || (!parsed.type && parsed.content)) {
              const text = parsed.content as string;
              const cleaned = text
                .replace(/\[CD\d+\]/g, "")
                .replace(/\[P\d+\]/g, "")
                .replace(/\[Q\d+\]/g, "")
                .replace(/\[A\d+\]/g, "")
                .replace(/\[W\d+\]/g, "")
                .replace(/\[UD\d+\]/g, "")
                .replace(/\[SKELETON_COMPLETE\]/g, "")
                .replace(/\[Searching database and building structure\.\.\.\]/g, "")
                .replace(/\[Skeleton extraction error[^\]]*\]/g, "")
                .replace(/\[Source material \d+% exhausted[^\]]*\]/g, "")
                .replace(/\[Word Count:[^\]]*\]/g, "")
                .replace(/\[Material Used:[^\]]*\]/g, "")
                .replace(/\[Claims Logged:[^\]]*\]/g, "")
                .replace(/\[Generation error[^\]]*\]/g, "")
                .replace(/\[Unable to generate[^\]]*\]/g, "")
                .replace(/\[Attempting to continue[^\]]*\]/g, "");
              if (cleaned.trim() || cleaned.includes("\n")) {
                setArtifacts(prev => ({ ...prev, debate: prev.debate + cleaned }));
              }
            }
          } catch {
            // skip unparseable lines
          }
        }
      }
    } catch (error) {
      console.error("Debate error:", error);
      setArtifacts(prev => ({ ...prev, debate: prev.debate + "\n\nError generating debate. Please try again." }));
    } finally {
      setIsStreaming(false);
    }
  };

  const handleClear = () => {
    setTopic("");
    setDocumentContent("");
    setDebaters([]);
    setDebaterDocuments({});
    setArtifacts({ outline: "", skeleton: "", documentCitations: "", debaterContent: "", debate: "" });
  };

  const hasAnyContent = Object.values(artifacts).some(v => v.length > 0);

  const handleDownloadAll = () => {
    const allContent = [
      artifacts.outline ? `=== ARTIFACT 1: OUTLINE ===\n\n${artifacts.outline}` : "",
      artifacts.skeleton ? `\n\n=== ARTIFACT 2: SKELETON ===\n\n${artifacts.skeleton}` : "",
      artifacts.documentCitations ? `\n\n=== ARTIFACT 3: SOURCE DOCUMENT QUOTATIONS ===\n\n${artifacts.documentCitations}` : "",
      artifacts.debaterContent ? `\n\n=== ARTIFACT 4: PER-DEBATER DATABASE CONTENT ===\n\n${artifacts.debaterContent}` : "",
      artifacts.debate ? `\n\n=== ARTIFACT 5: THE DEBATE ===\n\n${artifacts.debate}` : "",
    ].filter(Boolean).join("");
    downloadText(allContent, `complete-debate-${Date.now()}.txt`);
  };

  return (
    <Card className="p-6">
      <SectionHeader
        title="Debate Creator"
        subtitle="Generate structured debates between philosophers (up to 100,000 words) with 5 downloadable artifacts"
        onClear={handleClear}
        onCopy={() => copyToClipboard(artifacts.debate)}
        onDownload={handleDownloadAll}
        hasContent={hasAnyContent}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div className="border border-dashed border-primary/40 rounded-md p-4 bg-primary/5">
            <Label className="mb-1 block text-base font-semibold">Common Document for Debate</Label>
            <p className="text-xs text-muted-foreground mb-3">
              Upload the document, article, or text that all debaters will discuss and argue about.
              Every participant will quote directly from this shared material using [CD#] citation codes.
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

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <Label className="block">Debate Artifacts (5 outputs)</Label>
            {hasAnyContent && (
              <Button variant="outline" size="sm" onClick={handleDownloadAll} data-testid="button-download-all">
                <Download className="h-3 w-3 mr-1" /> Download All
              </Button>
            )}
          </div>

          <ArtifactPanel title="1. Outline" content={artifacts.outline} artifactKey="outline" isStreaming={isStreaming && !artifacts.outline} />
          <ArtifactPanel title="2. Skeleton" content={artifacts.skeleton} artifactKey="skeleton" isStreaming={isStreaming && !artifacts.skeleton && !!artifacts.outline} />
          <ArtifactPanel title="3. Source Document Quotations [CD#]" content={artifacts.documentCitations} artifactKey="documentCitations" isStreaming={isStreaming && !artifacts.documentCitations && !!artifacts.skeleton && !!documentContent} />
          <ArtifactPanel title="4. Per-Debater Database Content" content={artifacts.debaterContent} artifactKey="debaterContent" isStreaming={isStreaming && !artifacts.debaterContent && !!artifacts.outline} />
          
          <div className="border rounded-md" data-testid="artifact-debate">
            <div className="flex items-center justify-between gap-2 p-3 border-b bg-muted/30">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" />
                <span className="text-sm font-semibold">5. The Debate</span>
                {artifacts.debate && (
                  <Badge variant="outline" className="text-xs">
                    {artifacts.debate.split(/\s+/).filter(Boolean).length.toLocaleString()} words
                  </Badge>
                )}
              </div>
              {artifacts.debate && (
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" onClick={() => copyToClipboard(artifacts.debate)} data-testid="button-copy-debate">
                    <Copy className="h-3 w-3" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => downloadText(artifacts.debate, `debate-text-${Date.now()}.txt`)} data-testid="button-download-debate">
                    <Download className="h-3 w-3" />
                  </Button>
                </div>
              )}
            </div>
            <StreamingOutput 
              content={artifacts.debate} 
              isStreaming={isStreaming && !!artifacts.debaterContent} 
              placeholder="The debate will stream here after artifacts are prepared..." 
            />
          </div>
        </div>
      </div>
    </Card>
  );
}
