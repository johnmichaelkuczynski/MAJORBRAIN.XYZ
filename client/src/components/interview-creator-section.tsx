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
import { streamResponse, downloadText, copyToClipboard } from "@/lib/streaming";

export function InterviewCreatorSection() {
  const [topic, setTopic] = useState("");
  const [documentContent, setDocumentContent] = useState("");
  const [interviewee, setInterviewee] = useState("");
  const [interviewer, setInterviewer] = useState("");
  const [wordCount, setWordCount] = useState(2000);
  const [quoteCount, setQuoteCount] = useState(10);
  const [enhanced, setEnhanced] = useState(true);
  const [selectedModel, setSelectedModel] = useState("gpt-4o");
  const [output, setOutput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);

  const handleFileContent = (content: string, fileName: string) => {
    setDocumentContent(content);
    if (!topic.trim()) {
      setTopic(`Interview about: ${fileName}`);
    }
  };

  const handleGenerate = async () => {
    if (!topic.trim() || !interviewee || isStreaming) return;

    setIsStreaming(true);
    setOutput("");

    try {
      const fullTopic = documentContent ? `${topic}\n\n--- DOCUMENT TO DISCUSS ---\n${documentContent}` : topic;
      const response = await fetch("/api/interview/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: fullTopic.trim(), interviewee, interviewer: interviewer || undefined, wordCount, quoteCount, enhanced, model: selectedModel }),
      });

      if (!response.ok) throw new Error("Failed to generate interview");

      for await (const chunk of streamResponse(response)) {
        setOutput(prev => prev + chunk);
      }
    } catch (error) {
      console.error("Interview error:", error);
      setOutput("Error generating interview. Please try again.");
    } finally {
      setIsStreaming(false);
    }
  };

  const handleClear = () => { setTopic(""); setDocumentContent(""); setInterviewee(""); setInterviewer(""); setOutput(""); };
  const handleCopy = () => { copyToClipboard(output); };
  const handleDownload = () => { downloadText(output, `interview-${interviewee}-${Date.now()}.txt`); };

  return (
    <Card className="p-6">
      <SectionHeader
        title="Interview Creator"
        subtitle="Generate interview-format discussions (up to 100,000 words)"
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
            <Label className="mb-2 block">Interview Topic / Questions</Label>
            <Textarea 
              value={topic} 
              onChange={(e) => setTopic(e.target.value)} 
              placeholder="Enter the interview topic, specific questions to ask, or instructions for discussing the uploaded document..."
              className="min-h-[200px] text-base"
              data-testid="input-interview-topic" 
            />
            {documentContent && (
              <p className="text-xs text-muted-foreground mt-1">Document loaded: {documentContent.split(/\s+/).length.toLocaleString()} words</p>
            )}
          </div>

          <div>
            <Label className="mb-2 block">Interviewee (Required)</Label>
            <ThinkerSelect value={interviewee} onChange={setInterviewee} className="w-full" placeholder="Select the interviewee..." excludeIds={interviewer ? [interviewer] : []} />
          </div>

          <div>
            <Label className="mb-2 block">Interviewer (Optional)</Label>
            <ThinkerSelect value={interviewer} onChange={setInterviewer} className="w-full" placeholder="Select the interviewer (or leave for generic)..." excludeIds={interviewee ? [interviewee] : []} />
          </div>

          <GenerationControls wordCount={wordCount} onWordCountChange={setWordCount} quoteCount={quoteCount} onQuoteCountChange={setQuoteCount} enhanced={enhanced} onEnhancedChange={setEnhanced} />

          <ModelSelect value={selectedModel} onChange={setSelectedModel} className="w-full" />

          <Button onClick={handleGenerate} disabled={!topic.trim() || !interviewee || isStreaming} className="w-full" data-testid="button-generate-interview">
            {isStreaming ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Generating...</> : <><Play className="mr-2 h-4 w-4" />Generate Interview</>}
          </Button>
        </div>

        <div>
          <Label className="mb-2 block">Output</Label>
          <StreamingOutput content={output} isStreaming={isStreaming} placeholder="Interview will appear here..." />
        </div>
      </div>
    </Card>
  );
}
