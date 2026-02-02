import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SectionHeader } from "./section-header";
import { GenerationControls } from "./generation-controls";
import { StreamingOutput } from "./streaming-output";
import { FileUpload } from "./file-upload";
import { downloadText, copyToClipboard } from "@/lib/streaming";

export function QuoteGeneratorSection() {
  const [inputText, setInputText] = useState("");
  const [documentContent, setDocumentContent] = useState("");
  const [output, setOutput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [wordCount, setWordCount] = useState(2000);
  const [quoteCount, setQuoteCount] = useState(10);
  const [enhanced, setEnhanced] = useState(true);

  const handleFileContent = (content: string, fileName: string) => {
    setDocumentContent(content);
    if (!inputText.trim()) {
      setInputText(`Extract quotes from: ${fileName}`);
    }
  };

  const handleTextSubmit = async () => {
    const textToProcess = documentContent || inputText.trim();
    if (!textToProcess || isLoading) return;

    setIsLoading(true);

    try {
      const response = await fetch("/api/quotes/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: textToProcess, quoteCount }),
      });

      if (!response.ok) throw new Error("Failed to extract quotes");

      const data = await response.json();
      setOutput(data.quotes?.slice(0, quoteCount).join("\n\n---\n\n") || "No quotes found");
    } catch (error) {
      console.error("Quote extraction error:", error);
      setOutput("Error extracting quotes. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleClear = () => { setInputText(""); setDocumentContent(""); setOutput(""); };
  const handleCopy = () => { copyToClipboard(output); };
  const handleDownload = () => { downloadText(output, `extracted-quotes-${Date.now()}.txt`); };

  return (
    <Card className="p-6">
      <SectionHeader
        title="Quote Generator"
        subtitle="Extract quotes from uploaded documents (up to 200K words)"
        onClear={handleClear}
        onCopy={handleCopy}
        onDownload={handleDownload}
        hasContent={!!output}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div>
            <Label className="mb-2 block">Upload Document</Label>
            <FileUpload onFileContent={handleFileContent} disabled={isLoading} />
            {documentContent && (
              <p className="text-xs text-muted-foreground mt-1">Document loaded: {documentContent.split(/\s+/).length.toLocaleString()} words</p>
            )}
          </div>

          <div className="flex items-center gap-4">
            <div className="flex-1 border-t" />
            <span className="text-sm text-muted-foreground">OR</span>
            <div className="flex-1 border-t" />
          </div>

          <div>
            <Label className="mb-2 block">Paste Text</Label>
            <Textarea 
              value={inputText} 
              onChange={(e) => setInputText(e.target.value)} 
              placeholder="Paste text to extract quotes from..."
              className="min-h-[200px] text-base"
              data-testid="input-quote-text" 
            />
          </div>

          <GenerationControls wordCount={wordCount} onWordCountChange={setWordCount} quoteCount={quoteCount} onQuoteCountChange={setQuoteCount} enhanced={enhanced} onEnhancedChange={setEnhanced} />

          <Button onClick={handleTextSubmit} disabled={(!inputText.trim() && !documentContent) || isLoading} className="w-full" data-testid="button-extract-quotes">
            {isLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Processing...</> : "Extract Quotes"}
          </Button>
        </div>

        <div>
          <Label className="mb-2 block">Extracted Quotes</Label>
          <StreamingOutput content={output} isStreaming={isLoading} placeholder="Quotes will appear here..." />
        </div>
      </div>
    </Card>
  );
}
