import { Trash2, Copy, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  onClear: () => void;
  onCopy: () => void;
  onDownload: () => void;
  hasContent: boolean;
}

export function SectionHeader({ 
  title, 
  subtitle, 
  onClear, 
  onCopy, 
  onDownload, 
  hasContent 
}: SectionHeaderProps) {
  const { toast } = useToast();

  const handleCopy = () => {
    onCopy();
    toast({
      title: "Copied",
      description: "Content copied to clipboard",
    });
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        {subtitle && (
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={handleCopy}
          disabled={!hasContent}
          data-testid={`button-copy-${title.toLowerCase().replace(/\s+/g, '-')}`}
        >
          <Copy className="h-4 w-4 mr-1" />
          Copy
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onDownload}
          disabled={!hasContent}
          data-testid={`button-download-${title.toLowerCase().replace(/\s+/g, '-')}`}
        >
          <Download className="h-4 w-4 mr-1" />
          Download
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onClear}
          disabled={!hasContent}
          data-testid={`button-clear-${title.toLowerCase().replace(/\s+/g, '-')}`}
        >
          <Trash2 className="h-4 w-4 mr-1" />
          Clear
        </Button>
      </div>
    </div>
  );
}
