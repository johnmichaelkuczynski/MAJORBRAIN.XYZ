import { useState, useEffect } from "react";
import { Play, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { SectionHeader } from "./section-header";
import { ModelSelect } from "./model-select";
import { StreamingOutput } from "./streaming-output";
import { FileUpload } from "./file-upload";
import { streamResponseSimple, downloadText, copyToClipboard } from "@/lib/streaming";
import { useContentTransfer } from "@/lib/content-transfer";

export function ModelBuilderSection() {
  const [inputText, setInputText] = useState("");
  const [documentContent, setDocumentContent] = useState("");
  const [customInstructions, setCustomInstructions] = useState("");
  const [mode, setMode] = useState<"formal" | "informal">("formal");
  const [selectedModel, setSelectedModel] = useState("gpt-4o");
  const [output, setOutput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const { modelBuilderInput, setModelBuilderInput } = useContentTransfer();

  useEffect(() => {
    if (modelBuilderInput) {
      setInputText(modelBuilderInput);
      setModelBuilderInput("");
    }
  }, [modelBuilderInput, setModelBuilderInput]);

  const handleFileContent = (content: string, fileName: string) => {
    setDocumentContent(content);
    if (!inputText.trim()) {
      setInputText(`Build a ${mode} model for the content in: ${fileName}`);
    }
  };

  const handleGenerate = async () => {
    if (!inputText.trim() || isStreaming) return;

    setIsStreaming(true);
    setOutput("");

    try {
      const fullInput = documentContent ? `${inputText}\n\n--- DOCUMENT TO MODEL ---\n${documentContent}` : inputText;
      const response = await fetch("/api/model-builder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inputText: fullInput.trim(), mode, model: selectedModel, customInstructions: customInstructions.trim() || undefined }),
      });

      if (!response.ok) throw new Error("Failed to generate model");

      for await (const chunk of streamResponseSimple(response)) {
        setOutput(prev => prev + chunk);
      }
    } catch (error) {
      console.error("Model builder error:", error);
      setOutput("Error generating model. Please try again.");
    } finally {
      setIsStreaming(false);
    }
  };

  const handleClear = () => { setInputText(""); setDocumentContent(""); setCustomInstructions(""); setOutput(""); };
  const handleCopy = () => { copyToClipboard(output); };
  const handleDownload = async () => { await downloadText(output, `logical-model-${mode}-${Date.now()}.txt`); };

  return (
    <Card className="p-6" id="model-builder-section">
      <SectionHeader
        title="Model Builder"
        subtitle="Build formal or informal logical models from any input text"
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
            <Label className="mb-2 block">Input Text / Propositions to Model</Label>
            <Textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Enter the propositions, claims, or text you want to build a logical model for..."
              className="min-h-[200px] text-base"
              data-testid="input-model-text"
            />
            {documentContent && (
              <p className="text-xs text-muted-foreground mt-1">Document loaded: {documentContent.split(/\s+/).length.toLocaleString()} words</p>
            )}
          </div>

          <div>
            <Label className="mb-2 block">Custom Instructions (Optional)</Label>
            <Textarea
              value={customInstructions}
              onChange={(e) => setCustomInstructions(e.target.value)}
              placeholder='e.g., "Reinterpret "God" as a mathematical operator", "Use set-theoretic notation only", "Model as a lattice structure"...'
              className="min-h-[80px] text-sm"
              data-testid="input-model-instructions"
            />
          </div>

          <div className="flex flex-wrap gap-4 items-center">
            <RadioGroup value={mode} onValueChange={(v) => setMode(v as "formal" | "informal")} className="flex gap-4">
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="formal" id="formal" data-testid="radio-formal" />
                <Label htmlFor="formal">Formal</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="informal" id="informal" data-testid="radio-informal" />
                <Label htmlFor="informal">Informal</Label>
              </div>
            </RadioGroup>
            <ModelSelect value={selectedModel} onChange={setSelectedModel} className="w-48" />
          </div>

          <Button onClick={handleGenerate} disabled={!inputText.trim() || isStreaming} className="w-full" data-testid="button-generate-model">
            {isStreaming ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Building Model...</> : <><Play className="mr-2 h-4 w-4" />Build Model</>}
          </Button>
        </div>

        <div>
          <Label className="mb-2 block">Output</Label>
          <StreamingOutput content={output} isStreaming={isStreaming} placeholder="Model output will appear here..." />
        </div>
      </div>
    </Card>
  );
}
