import { useState, useRef, useEffect } from "react";
import { Send, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { SectionHeader } from "./section-header";
import { ModelSelect } from "./model-select";
import { GenerationControls } from "./generation-controls";
import { FileUpload } from "./file-upload";
import { streamResponseSimple, downloadText, copyToClipboard } from "@/lib/streaming";
import { useToast } from "@/hooks/use-toast";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export function AiChatSection() {
  const [selectedModel, setSelectedModel] = useState("gpt-4o");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [documentContent, setDocumentContent] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [wordCount, setWordCount] = useState(2000);
  const [quoteCount, setQuoteCount] = useState(10);
  const [enhanced, setEnhanced] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleFileContent = (content: string, fileName: string) => {
    setDocumentContent(content);
    if (!input.trim()) {
      setInput(`Please analyze this document: ${fileName}`);
    }
    toast({ title: "Document Loaded", description: `${content.split(/\s+/).length.toLocaleString()} words loaded` });
  };

  const handleSubmit = async () => {
    if (!input.trim() || isStreaming) return;

    const userMessage = documentContent 
      ? `${input.trim()}\n\n--- DOCUMENT ---\n${documentContent}` 
      : input.trim();
    
    setInput("");
    setDocumentContent("");
    setMessages(prev => [...prev, { role: "user", content: input.trim() + (documentContent ? ` [Document: ${documentContent.split(/\s+/).length.toLocaleString()} words]` : "") }]);
    setIsStreaming(true);

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMessage, model: selectedModel, wordCount, quoteCount, enhanced, history: messages }),
      });

      if (!response.ok) throw new Error("Failed to get response");

      let assistantContent = "";
      setMessages(prev => [...prev, { role: "assistant", content: "" }]);

      for await (const chunk of streamResponseSimple(response)) {
        assistantContent += chunk;
        setMessages(prev => {
          const newMessages = [...prev];
          newMessages[newMessages.length - 1] = { role: "assistant", content: assistantContent };
          return newMessages;
        });
      }
    } catch (error) {
      console.error("AI Chat error:", error);
      setMessages(prev => [...prev, { role: "assistant", content: "I apologize, but I encountered an error. Please try again." }]);
    } finally {
      setIsStreaming(false);
    }
  };

  const handleClear = () => { setMessages([]); setInput(""); setDocumentContent(""); };
  const handleCopy = () => { copyToClipboard(messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join("\n\n")); };
  const handleDownload = async () => { await downloadText(messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join("\n\n"), `ai-chat-${Date.now()}.txt`); };

  return (
    <Card className="p-6">
      <SectionHeader
        title="AI Chat"
        subtitle="General purpose AI assistant for any questions"
        onClear={handleClear}
        onCopy={handleCopy}
        onDownload={handleDownload}
        hasContent={messages.length > 0}
      />

      <div className="flex flex-wrap gap-4 mb-4">
        <ModelSelect value={selectedModel} onChange={setSelectedModel} className="w-48" />
      </div>

      <GenerationControls wordCount={wordCount} onWordCountChange={setWordCount} quoteCount={quoteCount} onQuoteCountChange={setQuoteCount} enhanced={enhanced} onEnhancedChange={setEnhanced} />

      <div className="min-h-[300px] max-h-[500px] overflow-y-auto rounded-md border bg-muted/20 p-4 my-4">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <p>Start a conversation...</p>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((message, index) => (
              <div key={index} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] rounded-lg p-3 ${message.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`} data-testid={`ai-message-${message.role}-${index}`}>
                  <p className="text-sm font-medium mb-1">{message.role === "user" ? "You" : "AI"}</p>
                  <p className="whitespace-pre-wrap">{message.content}</p>
                  {isStreaming && message.role === "assistant" && index === messages.length - 1 && (
                    <span className="inline-block w-2 h-4 bg-foreground animate-pulse ml-1" />
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      <div className="space-y-4">
        <div>
          <Label className="mb-2 block">Upload Document (Optional)</Label>
          <FileUpload onFileContent={handleFileContent} disabled={isStreaming} />
          {documentContent && (
            <p className="text-xs text-muted-foreground mt-1">Document loaded: {documentContent.split(/\s+/).length.toLocaleString()} words - will be included in next message</p>
          )}
        </div>

        <div className="flex gap-2">
          <Textarea 
            value={input} 
            onChange={(e) => setInput(e.target.value)} 
            placeholder="Ask the AI anything, or upload a document to discuss..." 
            className="min-h-[120px] text-base" 
            disabled={isStreaming} 
            data-testid="input-ai-chat-message" 
          />
          <Button onClick={handleSubmit} disabled={!input.trim() || isStreaming} className="min-h-[120px] px-4" data-testid="button-send-ai-message">
            {isStreaming ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
          </Button>
        </div>
      </div>
    </Card>
  );
}
