import { useState, useRef, useCallback } from "react";
import { Upload, X, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface FileUploadProps {
  onFileContent: (content: string, fileName: string) => void;
  accept?: string;
  className?: string;
  disabled?: boolean;
}

export function FileUpload({ onFileContent, accept = ".txt,.doc,.docx,.pdf,.md,.rtf", className = "", disabled = false }: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(async (file: File) => {
    setIsProcessing(true);
    setFileName(file.name);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/parse-file", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const text = await file.text();
        onFileContent(text, file.name);
      } else {
        const data = await response.json();
        onFileContent(data.content || "", file.name);
      }
    } catch (error) {
      const text = await file.text();
      onFileContent(text, file.name);
    } finally {
      setIsProcessing(false);
    }
  }, [onFileContent]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) setIsDragging(true);
  }, [disabled]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (disabled) return;

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      processFile(files[0]);
    }
  }, [disabled, processFile]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      processFile(files[0]);
    }
  }, [processFile]);

  const handleClick = () => {
    if (!disabled && !isProcessing) {
      fileInputRef.current?.click();
    }
  };

  const clearFile = (e: React.MouseEvent) => {
    e.stopPropagation();
    setFileName(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <div
      className={`relative border-2 border-dashed rounded-md p-4 transition-colors cursor-pointer ${
        isDragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
      } ${disabled ? "opacity-50 cursor-not-allowed" : ""} ${className}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleClick}
      data-testid="file-upload-dropzone"
    >
      <input
        ref={fileInputRef}
        type="file"
        accept={accept}
        onChange={handleFileSelect}
        className="hidden"
        disabled={disabled}
        data-testid="input-file-upload"
      />
      
      <div className="flex flex-col items-center justify-center gap-2 text-center">
        {isProcessing ? (
          <>
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Processing {fileName}...</span>
          </>
        ) : fileName ? (
          <>
            <div className="flex items-center gap-2">
              <FileText className="h-6 w-6 text-primary" />
              <span className="text-sm font-medium">{fileName}</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={clearFile}
                data-testid="button-clear-file"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <span className="text-xs text-muted-foreground">Click or drag to replace</span>
          </>
        ) : (
          <>
            <Upload className="h-8 w-8 text-muted-foreground" />
            <div>
              <span className="text-sm font-medium">Drop a document here</span>
              <span className="text-sm text-muted-foreground"> or click to upload</span>
            </div>
            <span className="text-xs text-muted-foreground">Supports TXT, DOC, DOCX, PDF, MD (up to 200K words)</span>
          </>
        )}
      </div>
    </div>
  );
}
