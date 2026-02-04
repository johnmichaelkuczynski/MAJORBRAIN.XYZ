import { useState } from "react";
import { FileText, Loader2, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { SectionHeader } from "./section-header";
import { FileUpload } from "./file-upload";
import { StreamingOutput } from "./streaming-output";
import { streamResponseSimple, downloadText, copyToClipboard } from "@/lib/streaming";
import { ModelSelect } from "./model-select";

export function DocumentAnalyzerSection() {
  const [documentContent, setDocumentContent] = useState("");
  const [authorName, setAuthorName] = useState("");
  const [documentTitle, setDocumentTitle] = useState("");
  const [selectedModel, setSelectedModel] = useState("gpt-4o");
  const [output, setOutput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [coreDocNumber, setCoreDocNumber] = useState(1);

  const handleFileContent = (content: string, fileName: string) => {
    setDocumentContent(content);
    if (!documentTitle.trim()) {
      setDocumentTitle(fileName.replace(/\.[^/.]+$/, ""));
    }
  };

  const handleAnalyze = async () => {
    if (!documentContent.trim() || !authorName.trim() || isStreaming) return;

    setIsStreaming(true);
    setOutput("");

    try {
      const response = await fetch("/api/document/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: documentContent.trim(),
          author: authorName.trim(),
          title: documentTitle.trim() || "Untitled",
          model: selectedModel,
        }),
      });

      if (!response.ok) throw new Error("Failed to analyze document");

      for await (const chunk of streamResponseSimple(response)) {
        setOutput(prev => prev + chunk);
      }
    } catch (error) {
      console.error("Analysis error:", error);
      setOutput("Error analyzing document. Please try again.");
    } finally {
      setIsStreaming(false);
    }
  };

  const handleClear = () => {
    setDocumentContent("");
    setAuthorName("");
    setDocumentTitle("");
    setOutput("");
  };

  const handleCopy = () => {
    copyToClipboard(output);
  };

  const handleDownloadCore = () => {
    const sanitizedAuthor = authorName.trim().replace(/\s+/g, "_").toUpperCase();
    const filename = `CORE_${sanitizedAuthor}_${coreDocNumber}.txt`;
    downloadText(output, filename);
    setCoreDocNumber(prev => prev + 1);
  };

  const wordCount = documentContent.split(/\s+/).filter(w => w.length > 0).length;

  return (
    <Card className="p-6">
      <SectionHeader
        title="Document Analyzer"
        subtitle="Analyze documents to extract CORE content (outline, positions, arguments, trends, Q&A)"
        onClear={handleClear}
        onCopy={handleCopy}
        onDownload={handleDownloadCore}
        hasContent={!!output}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div>
            <Label className="mb-2 block">Upload Document (up to 100,000 words)</Label>
            <FileUpload onFileContent={handleFileContent} disabled={isStreaming} />
            {wordCount > 0 && (
              <p className="text-sm text-muted-foreground mt-1">{wordCount.toLocaleString()} words loaded</p>
            )}
          </div>

          <div>
            <Label htmlFor="author-name" className="mb-2 block">Author Name (Required)</Label>
            <Input
              id="author-name"
              value={authorName}
              onChange={(e) => setAuthorName(e.target.value)}
              placeholder="e.g., Freud, Kuczynski, Heisenberg"
              disabled={isStreaming}
              data-testid="input-author-name"
            />
          </div>

          <div>
            <Label htmlFor="doc-title" className="mb-2 block">Document Title (Optional)</Label>
            <Input
              id="doc-title"
              value={documentTitle}
              onChange={(e) => setDocumentTitle(e.target.value)}
              placeholder="e.g., Interpretation of Dreams"
              disabled={isStreaming}
              data-testid="input-doc-title"
            />
          </div>

          <div>
            <Label className="mb-2 block">Or Paste Text Directly</Label>
            <Textarea
              value={documentContent}
              onChange={(e) => setDocumentContent(e.target.value)}
              placeholder="Paste document text here..."
              className="min-h-[200px]"
              disabled={isStreaming}
              data-testid="textarea-document-content"
            />
          </div>

          <ModelSelect value={selectedModel} onChange={setSelectedModel} />

          <Button
            onClick={handleAnalyze}
            disabled={!documentContent.trim() || !authorName.trim() || isStreaming}
            className="w-full"
            data-testid="button-analyze-document"
          >
            {isStreaming ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <FileText className="mr-2 h-4 w-4" />
                Analyze Document
              </>
            )}
          </Button>

          {output && (
            <Button
              onClick={handleDownloadCore}
              variant="outline"
              className="w-full"
              data-testid="button-download-core"
            >
              <Download className="mr-2 h-4 w-4" />
              Download as CORE_{authorName.toUpperCase()}_{coreDocNumber}.txt
            </Button>
          )}
        </div>

        <div>
          <Label className="mb-2 block">Analysis Output</Label>
          <StreamingOutput content={output} isStreaming={isStreaming} />
        </div>
      </div>
    </Card>
  );
}
