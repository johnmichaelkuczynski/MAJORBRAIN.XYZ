import { useState, useCallback } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { GlobalControls } from "@/components/global-controls";
import { ContentTransferProvider } from "@/lib/content-transfer";
import { MainChatSection } from "@/components/main-chat-section";
import { ModelBuilderSection } from "@/components/model-builder-section";
import { DebateCreatorSection } from "@/components/debate-creator-section";
import { QuoteGeneratorSection } from "@/components/quote-generator-section";
import { PositionGeneratorSection } from "@/components/position-generator-section";
import { ArgumentGeneratorSection } from "@/components/argument-generator-section";
import { OutlineGeneratorSection } from "@/components/outline-generator-section";
import { FullDocumentSection } from "@/components/full-document-section";
import { AiChatSection } from "@/components/ai-chat-section";
import { DocumentAnalyzerSection } from "@/components/document-analyzer-section";

function App() {
  const [clearKey, setClearKey] = useState(0);

  const handleClearAll = useCallback(() => {
    setClearKey(prev => prev + 1);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="light" storageKey="ask-them-theme">
        <TooltipProvider>
          <ContentTransferProvider>
            <div className="min-h-screen bg-background">
              <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
                <div className="container mx-auto px-4 py-4">
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-3">
                      <img src="/images/major-brain-logo.png" alt="Major Brain" className="h-8 w-8 rounded-md" />
                      <div>
                        <h1 className="text-2xl font-bold tracking-tight">MAJOR BRAIN</h1>
                        <p className="text-sm text-muted-foreground">
                          Speak with the Greats
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <GlobalControls onClearAll={handleClearAll} />
                      <ThemeToggle />
                    </div>
                  </div>
                </div>
              </header>

              <main className="container mx-auto px-4 py-8">
                <div className="space-y-8" key={clearKey}>
                  <MainChatSection />
                  
                  <div id="model-builder-section">
                    <ModelBuilderSection />
                  </div>
                  
                  <DebateCreatorSection />
                  
                  <QuoteGeneratorSection />
                  
                  <PositionGeneratorSection />
                  
                  <ArgumentGeneratorSection />
                  
                  <OutlineGeneratorSection />
                  
                  <FullDocumentSection />
                  
                  <DocumentAnalyzerSection />
                  
                  <AiChatSection />
                </div>
              </main>

              <footer className="border-t py-6 mt-12">
                <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
                  <p>MAJOR BRAIN - Philosophical AI Platform</p>
                  <p className="mt-1">Grounded in actual philosophical writings</p>
                </div>
              </footer>
            </div>
            <Toaster />
          </ContentTransferProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
