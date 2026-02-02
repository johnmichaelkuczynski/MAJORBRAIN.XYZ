import { useState, useRef, useEffect } from "react";
import { Send, Loader2, Copy, Download, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { SectionHeader } from "./section-header";
import { ThinkerSelect } from "./thinker-select";
import { ModelSelect } from "./model-select";
import { GenerationControls } from "./generation-controls";
import { FileUpload } from "./file-upload";
import { streamResponse, downloadText, copyToClipboard } from "@/lib/streaming";
import { useContentTransfer } from "@/lib/content-transfer";
import { useToast } from "@/hooks/use-toast";
import { THINKERS } from "@shared/schema";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export function MainChatSection() {
  const [selectedThinker, setSelectedThinker] = useState("kuczynski");
  const [selectedModel, setSelectedModel] = useState("gpt-4o");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [documentContent, setDocumentContent] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [wordCount, setWordCount] = useState(2000);
  const [quoteCount, setQuoteCount] = useState(10);
  const [enhanced, setEnhanced] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { setModelBuilderInput } = useContentTransfer();
  const { toast } = useToast();

  const thinker = THINKERS.find(t => t.id === selectedThinker);

  const handleFileContent = (content: string, fileName: string) => {
    setDocumentContent(content);
    if (!input.trim()) {
      setInput(`Please discuss and analyze this document: ${fileName}`);
    }
    toast({ title: "Document Loaded", description: `${content.split(/\s+/).length.toLocaleString()} words loaded` });
  };

  const handleSubmit = async () => {
    if (!input.trim() || isStreaming) return;

    const userMessage = documentContent 
      ? `${input.trim()}\n\n--- DOCUMENT TO DISCUSS ---\n${documentContent}` 
      : input.trim();
    
    setInput("");
    setDocumentContent("");
    setMessages(prev => [...prev, { role: "user", content: input.trim() + (documentContent ? ` [Document: ${documentContent.split(/\s+/).length.toLocaleString()} words]` : "") }]);
    setIsStreaming(true);

    try {
      const response = await fetch(`/api/figures/${selectedThinker}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          message: userMessage,
          model: selectedModel,
          wordCount,
          quoteCount,
          enhanced
        }),
      });

      if (!response.ok) throw new Error("Failed to get response");

      let assistantContent = "";
      setMessages(prev => [...prev, { role: "assistant", content: "" }]);

      for await (const chunk of streamResponse(response)) {
        assistantContent += chunk;
        setMessages(prev => {
          const newMessages = [...prev];
          newMessages[newMessages.length - 1] = {
            role: "assistant",
            content: assistantContent
          };
          return newMessages;
        });
      }
    } catch (error) {
      console.error("Chat error:", error);
      setMessages(prev => [...prev, { 
        role: "assistant", 
        content: "I apologize, but I encountered an error. Please try again." 
      }]);
    } finally {
      setIsStreaming(false);
    }
  };

  const handleClear = () => {
    setMessages([]);
    setInput("");
    setDocumentContent("");
  };

  const handleCopy = () => {
    const text = messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join("\n\n");
    copyToClipboard(text);
  };

  const handleDownload = () => {
    const text = messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join("\n\n");
    downloadText(text, `chat-with-${selectedThinker}-${Date.now()}.txt`);
  };

  const handleCopyMessage = (content: string) => {
    copyToClipboard(content);
    toast({ title: "Copied", description: "Message copied to clipboard" });
  };

  const handleDownloadMessage = (content: string, index: number) => {
    downloadText(content, `${thinker?.name}-response-${index}-${Date.now()}.txt`);
    toast({ title: "Downloaded", description: "Message downloaded" });
  };

  const handleSendToModelBuilder = (content: string) => {
    setModelBuilderInput(content);
    toast({ title: "Sent to Model Builder", description: "Content transferred. Scroll down to Model Builder section." });
    document.getElementById("model-builder-section")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <Card className="p-6">
      <SectionHeader
        title={`Main Chat - ${thinker?.name || "Kuczynski"}`}
        subtitle="Ask philosophical questions grounded in actual writings"
        onClear={handleClear}
        onCopy={handleCopy}
        onDownload={handleDownload}
        hasContent={messages.length > 0}
      />

      <div className="flex flex-wrap gap-4 mb-4">
        <ThinkerSelect value={selectedThinker} onChange={setSelectedThinker} className="w-64" />
        <ModelSelect value={selectedModel} onChange={setSelectedModel} className="w-48" />
      </div>

      <GenerationControls
        wordCount={wordCount}
        onWordCountChange={setWordCount}
        quoteCount={quoteCount}
        onQuoteCountChange={setQuoteCount}
        enhanced={enhanced}
        onEnhancedChange={setEnhanced}
      />

      <div className="min-h-[400px] max-h-[600px] overflow-y-auto rounded-md border bg-muted/20 p-4 my-4">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <p>Start a conversation with {thinker?.name}...</p>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((message, index) => (
              <div key={index} className={`flex flex-col ${message.role === "user" ? "items-end" : "items-start"}`}>
                <div
                  className={`max-w-[80%] rounded-lg p-3 ${message.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}
                  data-testid={`message-${message.role}-${index}`}
                >
                  <p className="text-sm font-medium mb-1">{message.role === "user" ? "You" : thinker?.name}</p>
                  <p className="whitespace-pre-wrap">{message.content}</p>
                  {isStreaming && message.role === "assistant" && index === messages.length - 1 && (
                    <span className="inline-block w-2 h-4 bg-foreground animate-pulse ml-1" />
                  )}
                </div>
                {message.role === "assistant" && message.content && !isStreaming && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    <Button variant="ghost" size="sm" onClick={() => handleCopyMessage(message.content)} data-testid={`button-copy-message-${index}`}>
                      <Copy className="h-3 w-3 mr-1" /> Copy
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDownloadMessage(message.content, index)} data-testid={`button-download-message-${index}`}>
                      <Download className="h-3 w-3 mr-1" /> Download
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => handleSendToModelBuilder(message.content)} data-testid={`button-send-to-model-${index}`}>
                      <ArrowRight className="h-3 w-3 mr-1" /> To Model Builder
                    </Button>
                  </div>
                )}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      <div className="space-y-4">
        <div>
          <Label className="mb-2 block">Upload Document to Discuss (Optional)</Label>
          <FileUpload onFileContent={handleFileContent} disabled={isStreaming} />
          {documentContent && (
            <p className="text-xs text-muted-foreground mt-1">Document loaded: {documentContent.split(/\s+/).length.toLocaleString()} words - will be included in next message</p>
          )}
        </div>

        <div className="flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`Ask ${thinker?.name} a question, or upload a document and ask them to discuss it...`}
            className="min-h-[120px] text-base"
            disabled={isStreaming}
            data-testid="input-chat-message"
          />
          <Button onClick={handleSubmit} disabled={!input.trim() || isStreaming} className="min-h-[120px]" data-testid="button-send-message">
            {isStreaming ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
          </Button>
        </div>
      </div>
    </Card>
  );
}
