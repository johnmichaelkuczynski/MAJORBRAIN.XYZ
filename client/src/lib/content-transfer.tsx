import { createContext, useContext, useState, ReactNode } from "react";

interface ContentTransferContextType {
  modelBuilderInput: string;
  setModelBuilderInput: (content: string) => void;
}

const ContentTransferContext = createContext<ContentTransferContextType | null>(null);

export function ContentTransferProvider({ children }: { children: ReactNode }) {
  const [modelBuilderInput, setModelBuilderInput] = useState("");

  return (
    <ContentTransferContext.Provider value={{
      modelBuilderInput,
      setModelBuilderInput,
    }}>
      {children}
    </ContentTransferContext.Provider>
  );
}

export function useContentTransfer() {
  const context = useContext(ContentTransferContext);
  if (!context) {
    throw new Error("useContentTransfer must be used within ContentTransferProvider");
  }
  return context;
}
