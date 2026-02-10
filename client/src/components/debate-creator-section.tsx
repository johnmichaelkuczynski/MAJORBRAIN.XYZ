import { useState, useRef } from "react";
import { Play, Loader2, Plus, X, Download, Copy, FileText, Volume2, Square, Pause, Swords, Handshake, Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SectionHeader } from "./section-header";
import { ThinkerSelect } from "./thinker-select";
import { ModelSelect } from "./model-select";
import { GenerationControls } from "./generation-controls";
import { StreamingOutput } from "./streaming-output";
import { FileUpload } from "./file-upload";
import { downloadText, copyToClipboard } from "@/lib/streaming";
import { THINKERS } from "@shared/schema";

type ExchangeMode = "debate" | "dialogue" | "interview";

const MODE_CONFIG = {
  debate: {
    label: "Debate",
    icon: Swords,
    description: "Antagonistic exchange where thinkers challenge and critique each other's positions",
    participants: "Debaters",
    minParticipants: 2,
    maxParticipants: 4,
    artifactLabel: "The Debate",
    buttonLabel: "Generate Debate",
  },
  dialogue: {
    label: "Dialogue",
    icon: Handshake,
    description: "Cooperative exchange where thinkers explore ideas together and build on each other's insights",
    participants: "Speakers",
    minParticipants: 2,
    maxParticipants: 4,
    artifactLabel: "The Dialogue",
    buttonLabel: "Generate Dialogue",
  },
  interview: {
    label: "Interview",
    icon: Mic,
    description: "One thinker (or the user) interviews another thinker with probing questions",
    participants: "Participants",
    minParticipants: 2,
    maxParticipants: 2,
    artifactLabel: "The Interview",
    buttonLabel: "Generate Interview",
  },
};

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
  const [exchangeMode, setExchangeMode] = useState<ExchangeMode>("debate");
  const [topic, setTopic] = useState("");
  const [documentContent, setDocumentContent] = useState("");
  const [debaters, setDebaters] = useState<string[]>([]);
  const [currentDebater, setCurrentDebater] = useState("");
  const [interviewer, setInterviewer] = useState<"user" | string>("user");
  const [selectedModel, setSelectedModel] = useState("gpt-4o");
  const [isStreaming, setIsStreaming] = useState(false);
  const [wordCount, setWordCount] = useState(2000);
  const [quoteCount, setQuoteCount] = useState(10);
  const [enhanced, setEnhanced] = useState(true);
  const [responseLengthMode, setResponseLengthMode] = useState<"default" | "custom">("default");
  const [responseLengths, setResponseLengths] = useState<Record<string, number>>({});
  const [debaterDocuments, setDebaterDocuments] = useState<Record<string, string>>({});
  
  const modeConfig = MODE_CONFIG[exchangeMode];
  const [artifacts, setArtifacts] = useState<DebateArtifacts>({
    outline: "",
    skeleton: "",
    documentCitations: "",
    debaterContent: "",
    debate: "",
  });
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);
  const [audioProgress, setAudioProgress] = useState("");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioVoiceMap, setAudioVoiceMap] = useState<Record<string, string>>({});
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const addDebater = () => {
    if (currentDebater && !debaters.includes(currentDebater) && debaters.length < modeConfig.maxParticipants) {
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
    setResponseLengths(prev => {
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
    if (!topic.trim() || debaters.length < modeConfig.minParticipants || isStreaming) return;

    setIsStreaming(true);
    setArtifacts({ outline: "", skeleton: "", documentCitations: "", debaterContent: "", debate: "" });

    try {
      const debaterDocsPayload: Record<string, string> = {};
      for (const [id, doc] of Object.entries(debaterDocuments)) {
        if (doc.trim()) {
          debaterDocsPayload[id] = doc.trim();
        }
      }

      const responseLengthsPayload: Record<string, number> | undefined = 
        responseLengthMode === "custom" && Object.keys(responseLengths).length > 0
          ? responseLengths
          : undefined;

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
          exchangeMode,
          ...(exchangeMode === "interview" && { interviewer }),
          ...(documentContent.trim() && { commonDocument: documentContent.trim() }),
          ...(Object.keys(debaterDocsPayload).length > 0 && { debaterDocuments: debaterDocsPayload }),
          ...(responseLengthsPayload && { responseLengths: responseLengthsPayload }),
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

  const handleGenerateAudio = async () => {
    if (!artifacts.debate || isGeneratingAudio) return;

    setIsGeneratingAudio(true);
    setAudioProgress("Starting audio generation...");
    setAudioUrl(null);
    setAudioVoiceMap({});

    if (audioRef.current) {
      audioRef.current.pause();
      setIsPlaying(false);
    }

    try {
      const response = await fetch("/api/debate/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ debateText: artifacts.debate }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to generate audio");
      }

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
            if (parsed.type === "progress") {
              setAudioProgress(parsed.message);
            } else if (parsed.type === "audio") {
              const byteString = atob(parsed.audio);
              const bytes = new Uint8Array(byteString.length);
              for (let i = 0; i < byteString.length; i++) {
                bytes[i] = byteString.charCodeAt(i);
              }
              const blob = new Blob([bytes], { type: "audio/mpeg" });
              const url = URL.createObjectURL(blob);
              setAudioUrl(url);
              setAudioVoiceMap(parsed.voiceMap || {});
              setAudioProgress("Audio ready!");
            } else if (parsed.type === "error") {
              throw new Error(parsed.message);
            }
          } catch (e: any) {
            if (e.message && !e.message.includes("JSON")) {
              throw e;
            }
          }
        }
      }
    } catch (error: any) {
      console.error("Audio generation error:", error);
      setAudioProgress(`Error: ${error.message}`);
    } finally {
      setIsGeneratingAudio(false);
    }
  };

  const handlePlayPause = () => {
    if (!audioRef.current || !audioUrl) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play();
      setIsPlaying(true);
    }
  };

  const handleDownloadAudio = () => {
    if (!audioUrl) return;
    const a = document.createElement("a");
    a.href = audioUrl;
    a.download = `debate-audio-${Date.now()}.mp3`;
    a.click();
  };

  const handleClear = () => {
    setTopic("");
    setDocumentContent("");
    setDebaters([]);
    setInterviewer("user");
    setDebaterDocuments({});
    setResponseLengths({});
    setResponseLengthMode("default");
    setArtifacts({ outline: "", skeleton: "", documentCitations: "", debaterContent: "", debate: "" });
    if (audioRef.current) {
      audioRef.current.pause();
    }
    setAudioUrl(null);
    setAudioVoiceMap({});
    setAudioProgress("");
    setIsPlaying(false);
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

  const handleModeChange = (mode: ExchangeMode) => {
    setExchangeMode(mode);
    if (mode === "interview" && debaters.length > 2) {
      setDebaters(prev => prev.slice(0, 2));
    }
    setInterviewer("user");
  };

  return (
    <Card className="p-6">
      <SectionHeader
        title="Exchange Creator"
        subtitle="Generate debates, dialogues, or interviews between thinkers with 5 downloadable artifacts"
        onClear={handleClear}
        onCopy={() => copyToClipboard(artifacts.debate)}
        onDownload={handleDownloadAll}
        hasContent={hasAnyContent}
      />

      <div className="flex gap-2 mb-6" data-testid="exchange-mode-selector">
        {(Object.keys(MODE_CONFIG) as ExchangeMode[]).map(mode => {
          const config = MODE_CONFIG[mode];
          const Icon = config.icon;
          const isActive = exchangeMode === mode;
          return (
            <Button
              key={mode}
              variant={isActive ? "default" : "outline"}
              onClick={() => handleModeChange(mode)}
              className={`flex-1 ${isActive ? "" : ""}`}
              disabled={isStreaming}
              data-testid={`button-mode-${mode}`}
            >
              <Icon className="h-4 w-4 mr-2" />
              {config.label}
            </Button>
          );
        })}
      </div>
      <p className="text-sm text-muted-foreground mb-4">{modeConfig.description}</p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div className="border border-dashed border-primary/40 rounded-md p-4 bg-primary/5">
            <Label className="mb-1 block text-base font-semibold">Common Document</Label>
            <p className="text-xs text-muted-foreground mb-3">
              Upload a document, article, or text that all participants will discuss.
              Every participant will quote directly from this shared material using [CD#] citation codes.
            </p>
            <FileUpload onFileContent={handleFileContent} disabled={isStreaming} />
            {documentContent && (
              <p className="text-sm text-primary mt-2 font-medium">Document loaded: {documentContent.split(/\s+/).length.toLocaleString()} words</p>
            )}
          </div>

          <div>
            <Label className="mb-2 block">Topic / Instructions</Label>
            <Textarea 
              value={topic} 
              onChange={(e) => setTopic(e.target.value)} 
              placeholder={exchangeMode === "interview" 
                ? "Enter the interview topic or questions you want explored..." 
                : exchangeMode === "dialogue"
                ? "Enter the topic for cooperative exploration..."
                : "Enter the debate topic, thesis to argue, or instructions..."}
              className="min-h-[200px] text-base"
              data-testid="input-debate-topic" 
            />
          </div>

          {exchangeMode === "interview" ? (
            <div className="space-y-3">
              <Label className="mb-2 block">Interview Setup</Label>
              <div>
                <Label className="text-sm text-muted-foreground mb-1 block">Interviewer</Label>
                <Select value={interviewer} onValueChange={setInterviewer} disabled={isStreaming}>
                  <SelectTrigger data-testid="select-interviewer">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">User (You ask the questions)</SelectItem>
                    {THINKERS.filter(t => !debaters.includes(t.id) || debaters[0] === t.id).map(t => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-sm text-muted-foreground mb-1 block">Interviewee</Label>
                <ThinkerSelect 
                  value={debaters[0] || ""} 
                  onChange={(val) => {
                    setDebaters(val ? [val] : []);
                  }} 
                  className="w-full" 
                  placeholder="Choose who to interview..."
                  excludeIds={interviewer !== "user" ? [interviewer] : []}
                />
                {debaters[0] && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    <Badge variant="secondary" className="flex items-center gap-1">
                      {interviewer === "user" ? "User" : THINKERS.find(t => t.id === interviewer)?.name || interviewer} (Interviewer)
                    </Badge>
                    <Badge variant="secondary" className="flex items-center gap-1">
                      {THINKERS.find(t => t.id === debaters[0])?.name} (Interviewee)
                      <button onClick={() => setDebaters([])} className="ml-1 hover:text-destructive" data-testid="button-remove-interviewee">
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div>
              <Label className="mb-2 block">{modeConfig.participants} ({modeConfig.minParticipants}-{modeConfig.maxParticipants} participants)</Label>
              <div className="flex gap-2 mb-2">
                <ThinkerSelect value={currentDebater} onChange={setCurrentDebater} className="flex-1" placeholder={`Add a ${modeConfig.participants.toLowerCase().slice(0, -1)}...`} excludeIds={debaters} />
                <Button onClick={addDebater} disabled={!currentDebater || debaters.length >= modeConfig.maxParticipants} size="icon" variant="outline" data-testid="button-add-debater">
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
          )}

          {debaters.length >= modeConfig.minParticipants && (
            <div className="space-y-3">
              <Label className="block text-sm font-medium">Response Length per Participant</Label>
              <Select value={responseLengthMode} onValueChange={(v) => setResponseLengthMode(v as "default" | "custom")}>
                <SelectTrigger data-testid="select-response-length-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">Default (system decides response lengths)</SelectItem>
                  <SelectItem value="custom">Custom (set words per response for each debater)</SelectItem>
                </SelectContent>
              </Select>
              {responseLengthMode === "custom" && (
                <div className="space-y-2 pl-2 border-l-2 border-primary/20">
                  <p className="text-xs text-muted-foreground">
                    Set approximately how many words each debater should write per response turn.
                  </p>
                  {debaters.map(id => {
                    const thinker = THINKERS.find(t => t.id === id);
                    return (
                      <div key={id} className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs min-w-[100px] justify-center">{thinker?.name}</Badge>
                        <Input
                          type="number"
                          min={25}
                          max={2000}
                          value={responseLengths[id] || ""}
                          onChange={(e) => {
                            const val = parseInt(e.target.value);
                            if (!isNaN(val) && val >= 0) {
                              setResponseLengths(prev => ({ ...prev, [id]: val }));
                            } else if (e.target.value === "") {
                              setResponseLengths(prev => {
                                const next = { ...prev };
                                delete next[id];
                                return next;
                              });
                            }
                          }}
                          placeholder="e.g. 200"
                          className="w-28"
                          disabled={isStreaming}
                          data-testid={`input-response-length-${id}`}
                        />
                        <span className="text-xs text-muted-foreground">words/response</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {debaters.length > 0 && (
            <div className="space-y-3">
              <Label className="block text-sm font-medium">Individual Participant Material (Optional, up to {MAX_DEBATER_WORDS.toLocaleString()} words each)</Label>
              <p className="text-xs text-muted-foreground">
                Upload material specific to one participant only (e.g., that thinker's own writings).
                This is separate from the common document above, which all participants share.
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

          <Button onClick={handleGenerate} disabled={!topic.trim() || debaters.length < modeConfig.minParticipants || isStreaming} className="w-full" data-testid="button-generate-debate">
            {isStreaming ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Generating...</> : <><Play className="mr-2 h-4 w-4" />{modeConfig.buttonLabel}</>}
          </Button>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <Label className="block">{modeConfig.label} Artifacts (5 outputs)</Label>
            {hasAnyContent && (
              <Button variant="outline" size="sm" onClick={handleDownloadAll} data-testid="button-download-all">
                <Download className="h-3 w-3 mr-1" /> Download All
              </Button>
            )}
          </div>

          <ArtifactPanel title="1. Outline" content={artifacts.outline} artifactKey="outline" isStreaming={isStreaming && !artifacts.outline} />
          <ArtifactPanel title="2. Skeleton" content={artifacts.skeleton} artifactKey="skeleton" isStreaming={isStreaming && !artifacts.skeleton && !!artifacts.outline} />
          <ArtifactPanel title="3. Source Document Quotations [CD#]" content={artifacts.documentCitations} artifactKey="documentCitations" isStreaming={isStreaming && !artifacts.documentCitations && !!artifacts.skeleton && !!documentContent} />
          <ArtifactPanel title="4. Per-Participant Database Content" content={artifacts.debaterContent} artifactKey="debaterContent" isStreaming={isStreaming && !artifacts.debaterContent && !!artifacts.outline} />
          
          <div className="border rounded-md" data-testid="artifact-debate">
            <div className="flex items-center justify-between gap-2 p-3 border-b bg-muted/30">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" />
                <span className="text-sm font-semibold">5. {modeConfig.artifactLabel}</span>
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

          {artifacts.debate && !isStreaming && (
            <div className="border rounded-md" data-testid="audio-section">
              <div className="flex items-center justify-between gap-2 p-3 border-b bg-muted/30">
                <div className="flex items-center gap-2">
                  <Volume2 className="h-4 w-4 text-primary" />
                  <span className="text-sm font-semibold">Audio Version</span>
                </div>
              </div>
              <div className="p-3 space-y-3">
                {!audioUrl && !isGeneratingAudio && (
                  <Button
                    onClick={handleGenerateAudio}
                    variant="outline"
                    className="w-full"
                    data-testid="button-generate-audio"
                  >
                    <Volume2 className="mr-2 h-4 w-4" />
                    Convert Debate to Audio
                  </Button>
                )}

                {isGeneratingAudio && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>{audioProgress}</span>
                    </div>
                    <div className="h-1 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-primary rounded-full animate-pulse" style={{ width: "60%" }} />
                    </div>
                  </div>
                )}

                {audioUrl && (
                  <div className="space-y-3">
                    {Object.keys(audioVoiceMap).length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(audioVoiceMap).map(([speaker, voice]) => (
                          <Badge key={speaker} variant="outline" className="text-xs">
                            {speaker}: {voice}
                          </Badge>
                        ))}
                      </div>
                    )}

                    <audio
                      ref={audioRef}
                      src={audioUrl}
                      onEnded={() => setIsPlaying(false)}
                      onPause={() => setIsPlaying(false)}
                      onPlay={() => setIsPlaying(true)}
                      className="hidden"
                      data-testid="audio-player"
                    />

                    <div className="flex items-center gap-2">
                      <Button
                        onClick={handlePlayPause}
                        variant="outline"
                        size="icon"
                        data-testid="button-play-pause-audio"
                      >
                        {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                      </Button>
                      <Button
                        onClick={() => {
                          if (audioRef.current) {
                            audioRef.current.pause();
                            audioRef.current.currentTime = 0;
                            setIsPlaying(false);
                          }
                        }}
                        variant="outline"
                        size="icon"
                        data-testid="button-stop-audio"
                      >
                        <Square className="h-3 w-3" />
                      </Button>
                      <Button
                        onClick={handleDownloadAudio}
                        variant="outline"
                        size="icon"
                        data-testid="button-download-audio"
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                      <Button
                        onClick={handleGenerateAudio}
                        variant="outline"
                        size="sm"
                        data-testid="button-regenerate-audio"
                      >
                        <Volume2 className="mr-1 h-3 w-3" />
                        Regenerate
                      </Button>
                    </div>

                    <p className="text-xs text-muted-foreground">{audioProgress}</p>
                  </div>
                )}

                {!isGeneratingAudio && !audioUrl && audioProgress && audioProgress.startsWith("Error") && (
                  <p className="text-xs text-destructive">{audioProgress}</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
