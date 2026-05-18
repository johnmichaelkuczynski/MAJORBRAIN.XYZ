import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

interface GenerationControlsProps {
  wordCount: number;
  onWordCountChange: (value: number) => void;
  quoteCount: number;
  onQuoteCountChange: (value: number) => void;
  enhanced: boolean;
  onEnhancedChange: (value: boolean) => void;
  minWords?: number;
  maxWords?: number;
  quoteMode?: "exact" | "density";
  onQuoteModeChange?: (value: "exact" | "density") => void;
  quotesPer?: number;
  onQuotesPerChange?: (value: number) => void;
  perWords?: number;
  onPerWordsChange?: (value: number) => void;
}

export function GenerationControls({
  wordCount,
  onWordCountChange,
  quoteCount,
  onQuoteCountChange,
  enhanced,
  onEnhancedChange,
  minWords = 100,
  maxWords = 100000,
  quoteMode = "density",
  onQuoteModeChange,
  quotesPer = 1,
  onQuotesPerChange,
  perWords = 500,
  onPerWordsChange,
}: GenerationControlsProps) {
  const computedFromDensity = Math.max(1, Math.ceil((wordCount / Math.max(1, perWords)) * quotesPer));
  const effectiveQuoteCount = quoteMode === "density" ? computedFromDensity : quoteCount;

  const handleWordCountInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value) || minWords;
    const clamped = Math.max(minWords, Math.min(maxWords, val));
    onWordCountChange(clamped);
  };

  return (
    <div className="space-y-4 p-3 border rounded-md bg-muted/30">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Label>Word Count</Label>
          <Input
            type="number"
            value={wordCount}
            onChange={handleWordCountInput}
            min={minWords}
            max={maxWords}
            className="w-28 h-8 text-right"
            data-testid="input-word-count"
          />
        </div>
        <Slider
          value={[wordCount]}
          onValueChange={([v]) => onWordCountChange(v)}
          min={minWords}
          max={maxWords}
          step={100}
          className="w-full"
          data-testid="slider-word-count"
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{minWords.toLocaleString()}</span>
          <span>{maxWords.toLocaleString()}</span>
        </div>
      </div>

      <div className="space-y-3 pt-2 border-t">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-semibold">Verbatim quotes from author</Label>
          <span className="text-xs text-muted-foreground">
            → {effectiveQuoteCount} quote{effectiveQuoteCount === 1 ? "" : "s"} total
          </span>
        </div>

        <RadioGroup
          value={quoteMode}
          onValueChange={(v) => onQuoteModeChange?.(v as "exact" | "density")}
          className="flex gap-4"
        >
          <div className="flex items-center gap-2">
            <RadioGroupItem value="density" id="quote-mode-density" data-testid="radio-quote-mode-density" />
            <Label htmlFor="quote-mode-density" className="text-sm cursor-pointer">By density</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="exact" id="quote-mode-exact" data-testid="radio-quote-mode-exact" />
            <Label htmlFor="quote-mode-exact" className="text-sm cursor-pointer">Exact count</Label>
          </div>
        </RadioGroup>

        {quoteMode === "density" ? (
          <div className="flex items-end gap-2 text-sm">
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Quotes</Label>
              <Input
                type="number"
                value={quotesPer}
                min={1}
                onChange={(e) => onQuotesPerChange?.(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-20 h-8 text-right"
                data-testid="input-quotes-per"
              />
            </div>
            <span className="pb-2">per</span>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Words</Label>
              <Input
                type="number"
                value={perWords}
                min={50}
                step={50}
                onChange={(e) => onPerWordsChange?.(Math.max(50, parseInt(e.target.value) || 500))}
                className="w-24 h-8 text-right"
                data-testid="input-per-words"
              />
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <Label className="text-sm">Exact number of quotes</Label>
            <Input
              type="number"
              value={quoteCount}
              onChange={(e) => onQuoteCountChange(Math.max(0, parseInt(e.target.value) || 0))}
              min={0}
              className="w-28 h-8 text-right"
              data-testid="input-quote-count"
            />
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 pt-2 border-t">
        <div>
          <Label>Mode</Label>
          <p className="text-xs text-muted-foreground">
            {enhanced ? "Enhanced: Creative liberties allowed" : "Normal: Strict adherence to source material"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-sm ${!enhanced ? "font-medium" : "text-muted-foreground"}`}>Normal</span>
          <Switch
            checked={enhanced}
            onCheckedChange={onEnhancedChange}
            data-testid="switch-enhanced-mode"
          />
          <span className={`text-sm ${enhanced ? "font-medium" : "text-muted-foreground"}`}>Enhanced</span>
        </div>
      </div>
    </div>
  );
}
