import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const MODELS = [
  { id: "gpt-4o", name: "GPT-4o", provider: "OpenAI" },
  { id: "gpt-4o-mini", name: "GPT-4o Mini", provider: "OpenAI" },
  { id: "claude-sonnet-4", name: "Claude Sonnet 4", provider: "Anthropic" },
  { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", provider: "Anthropic" },
] as const;

interface ModelSelectProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function ModelSelect({ value, onChange, className }: ModelSelectProps) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={className} data-testid="select-model">
        <SelectValue placeholder="Select model" />
      </SelectTrigger>
      <SelectContent>
        {MODELS.map((model) => (
          <SelectItem key={model.id} value={model.id} data-testid={`select-model-${model.id}`}>
            <span className="flex items-center gap-2">
              <span>{model.name}</span>
              <span className="text-xs text-muted-foreground">({model.provider})</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
