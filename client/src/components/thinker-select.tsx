import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { THINKERS } from "@shared/schema";

interface ThinkerSelectProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
  excludeIds?: string[];
}

export function ThinkerSelect({ 
  value, 
  onChange, 
  className, 
  placeholder = "Select a thinker",
  excludeIds = []
}: ThinkerSelectProps) {
  const availableThinkers = THINKERS.filter(t => !excludeIds.includes(t.id));

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={className} data-testid="select-thinker">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {availableThinkers.map((thinker) => (
          <SelectItem key={thinker.id} value={thinker.id} data-testid={`select-thinker-${thinker.id}`}>
            {thinker.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
