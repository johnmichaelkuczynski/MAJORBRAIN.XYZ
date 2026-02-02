import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface GenerationControlsProps {
  wordCount: number;
  onWordCountChange: (value: number) => void;
  quoteCount: number;
  onQuoteCountChange: (value: number) => void;
  enhanced: boolean;
  onEnhancedChange: (value: boolean) => void;
  minWords?: number;
  maxWords?: number;
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
}: GenerationControlsProps) {
  const defaultQuotes = Math.ceil(wordCount / 200);

  const handleWordCountInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value) || minWords;
    const clamped = Math.max(minWords, Math.min(maxWords, val));
    onWordCountChange(clamped);
    if (quoteCount === Math.ceil(wordCount / 200)) {
      onQuoteCountChange(Math.ceil(clamped / 200));
    }
  };

  const handleWordCountSlider = (v: number) => {
    onWordCountChange(v);
    if (quoteCount === Math.ceil(wordCount / 200)) {
      onQuoteCountChange(Math.ceil(v / 200));
    }
  };

  const handleQuoteCountInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value) || 1;
    onQuoteCountChange(Math.max(0, val));
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
          onValueChange={([v]) => handleWordCountSlider(v)}
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

      <div className="flex items-center justify-between gap-2">
        <div>
          <Label>Quote Count</Label>
          <p className="text-xs text-muted-foreground">Default: 1 per 200 words = {defaultQuotes}</p>
        </div>
        <Input
          type="number"
          value={quoteCount}
          onChange={handleQuoteCountInput}
          min={0}
          className="w-28 h-8 text-right"
          data-testid="input-quote-count"
        />
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
