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
  { id: "venice/zai-org-glm-5-1", name: "GLM 5.1", provider: "Venice" },
  { id: "venice/grok-4-3", name: "Grok 4.3", provider: "Venice" },
  { id: "venice/claude-opus-4-7", name: "Claude Opus 4.7", provider: "Venice" },
  { id: "venice/claude-sonnet-4-6", name: "Claude Sonnet 4.6", provider: "Venice" },
  { id: "venice/openai-gpt-55", name: "GPT-5.5", provider: "Venice" },
  { id: "venice/kimi-k2-6", name: "Kimi K2.6", provider: "Venice" },
  { id: "venice/deepseek-v3.2", name: "DeepSeek V3.2", provider: "Venice" },
  { id: "venice/qwen-3-6-plus", name: "Qwen 3.6 Plus", provider: "Venice" },
  { id: "venice/venice-uncensored-1-2", name: "Venice Uncensored 1.2", provider: "Venice" },
  { id: "venice/llama-3.3-70b", name: "Llama 3.3 70B", provider: "Venice" },
  { id: "venice/minimax-m27", name: "MiniMax M2.7", provider: "Venice" },
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
