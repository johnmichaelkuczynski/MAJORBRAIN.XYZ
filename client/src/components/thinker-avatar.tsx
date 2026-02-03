interface ThinkerAvatarProps {
  thinkerId: string;
  name?: string;
  size?: "sm" | "md" | "lg" | "xl";
  isAnimating?: boolean;
  showName?: boolean;
  showCount?: boolean;
  count?: number;
  className?: string;
}

const THINKER_EMOJIS: Record<string, string> = {
  adler: "🧔",
  aesop: "📖",
  allen: "🎭",
  aristotle: "🏛️",
  bacon: "🔬",
  bergler: "🧠",
  bergson: "⏳",
  berkeley: "👁️",
  confucius: "🎎",
  darwin: "🦎",
  descartes: "💭",
  dewey: "📚",
  dworkin: "⚖️",
  engels: "⚒️",
  freud: "🛋️",
  galileo: "🔭",
  gardner: "🧩",
  goldman: "✊",
  hegel: "🌀",
  hobbes: "👑",
  hume: "🤔",
  james: "💡",
  kant: "⭐",
  kernberg: "💔",
  kuczynski: "⚙️",
  laplace: "🎲",
  leibniz: "♾️",
  luther: "✝️",
  "la-rochefoucauld": "🎭",
  machiavelli: "🦊",
  maimonides: "✡️",
  marden: "🎯",
  marx: "🔴",
  mill: "🏭",
  nietzsche: "⚡",
  peirce: "🔗",
  plato: "📐",
  poincare: "🔢",
  popper: "🔍",
  rousseau: "🌿",
  russell: "🔣",
  sartre: "🚬",
  schopenhauer: "🌑",
  smith: "💰",
  spencer: "🧬",
  stekel: "💫",
  tocqueville: "🗽",
  veblen: "👔",
  weyl: "📊",
  whewell: "🎓",
};

const THINKER_COLORS: Record<string, string> = {
  aristotle: "from-blue-400 to-blue-600",
  plato: "from-purple-400 to-purple-600",
  descartes: "from-teal-400 to-teal-600",
  kant: "from-indigo-400 to-indigo-600",
  nietzsche: "from-red-400 to-red-600",
  freud: "from-amber-400 to-amber-600",
  marx: "from-rose-400 to-rose-600",
  hegel: "from-violet-400 to-violet-600",
  spinoza: "from-emerald-400 to-emerald-600",
  kuczynski: "from-cyan-400 to-cyan-600",
  default: "from-primary to-accent",
};

export function ThinkerAvatar({ 
  thinkerId, 
  name,
  size = "md", 
  isAnimating = false, 
  showName = false,
  showCount = false,
  count = 0,
  className = "" 
}: ThinkerAvatarProps) {
  const sizeClasses = {
    sm: { container: "w-16", avatar: "h-10 w-10 text-lg", name: "text-xs" },
    md: { container: "w-20", avatar: "h-14 w-14 text-2xl", name: "text-xs" },
    lg: { container: "w-24", avatar: "h-16 w-16 text-3xl", name: "text-sm" },
    xl: { container: "w-28", avatar: "h-20 w-20 text-4xl", name: "text-base" },
  };

  const emoji = THINKER_EMOJIS[thinkerId.toLowerCase()] || "🧠";
  const colorClass = THINKER_COLORS[thinkerId.toLowerCase()] || THINKER_COLORS.default;
  const displayName = name || thinkerId.charAt(0).toUpperCase() + thinkerId.slice(1);

  return (
    <div 
      className={`flex flex-col items-center ${sizeClasses[size].container} ${className}`}
      data-testid={`avatar-thinker-${thinkerId.toLowerCase()}`}
    >
      <div 
        className={`
          ${sizeClasses[size].avatar} 
          rounded-xl 
          bg-gradient-to-br ${colorClass}
          flex items-center justify-center
          shadow-lg
          border-2 border-white/30
          ${isAnimating ? "animate-pulse" : ""}
        `}
        style={{ 
          animationDuration: isAnimating ? "1.5s" : undefined 
        }}
      >
        <span 
          className={isAnimating ? "animate-bounce" : ""}
          style={{ animationDuration: isAnimating ? "1s" : undefined }}
        >
          {emoji}
        </span>
      </div>
      
      {showName && (
        <div className="mt-1 text-center">
          <span className={`font-bold text-foreground uppercase tracking-wide ${sizeClasses[size].name}`}>
            {displayName.toUpperCase()}
          </span>
          {showCount && (
            <div className="text-muted-foreground text-xs">
              {count.toLocaleString()}
            </div>
          )}
        </div>
      )}
      
      {isAnimating && (
        <div 
          className="absolute inset-0 rounded-xl border-2 border-t-accent border-r-transparent border-b-transparent border-l-transparent animate-spin pointer-events-none"
          data-testid="avatar-spinner"
        />
      )}
    </div>
  );
}

export function ThinkerAvatarCard({ 
  thinkerId, 
  name,
  count = 0,
  isSelected = false,
  onClick,
  className = "" 
}: {
  thinkerId: string;
  name?: string;
  count?: number;
  isSelected?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  const emoji = THINKER_EMOJIS[thinkerId.toLowerCase()] || "🧠";
  const colorClass = THINKER_COLORS[thinkerId.toLowerCase()] || THINKER_COLORS.default;
  const displayName = name || thinkerId.charAt(0).toUpperCase() + thinkerId.slice(1);

  return (
    <button
      onClick={onClick}
      className={`
        flex flex-col items-center p-2 rounded-lg
        border-2 transition-all duration-200
        ${isSelected 
          ? "border-primary bg-primary/10 shadow-md" 
          : "border-border bg-card hover-elevate"
        }
        ${className}
      `}
      data-testid={`card-thinker-${thinkerId.toLowerCase()}`}
    >
      <div 
        className={`
          h-12 w-12 rounded-lg 
          bg-gradient-to-br ${colorClass}
          flex items-center justify-center
          text-2xl shadow-sm
        `}
      >
        {emoji}
      </div>
      <span className="mt-1 font-bold text-xs text-foreground uppercase tracking-wide">
        {displayName.length > 8 ? displayName.slice(0, 7) + "…" : displayName}
      </span>
      {count > 0 && (
        <span className="text-muted-foreground text-xs">
          {count.toLocaleString()}
        </span>
      )}
    </button>
  );
}
