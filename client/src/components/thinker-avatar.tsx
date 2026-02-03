import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import adlerImg from "../assets/thinkers/adler.png";

const THINKER_AVATARS: Record<string, string> = {
  adler: adlerImg,
};

interface ThinkerAvatarProps {
  thinkerId: string;
  size?: "sm" | "md" | "lg" | "xl";
  isAnimating?: boolean;
  className?: string;
}

export function ThinkerAvatar({ thinkerId, size = "md", isAnimating = false, className = "" }: ThinkerAvatarProps) {
  const sizeClasses = {
    sm: "h-8 w-8 text-xs",
    md: "h-12 w-12 text-sm",
    lg: "h-16 w-16 text-lg",
    xl: "h-24 w-24 text-2xl",
  };

  const avatarSrc = THINKER_AVATARS[thinkerId.toLowerCase()];

  return (
    <div className={`relative ${className}`}>
      <Avatar 
        className={`${sizeClasses[size]} border-2 border-primary shadow-lg ${isAnimating ? "animate-spin" : ""}`}
        style={{ animationDuration: isAnimating ? "3s" : undefined }}
        data-testid={`avatar-thinker-${thinkerId.toLowerCase()}`}
      >
        {avatarSrc && <AvatarImage src={avatarSrc} alt={thinkerId} className="object-cover" />}
        <AvatarFallback className="bg-gradient-to-br from-primary to-accent text-white font-bold">
          {thinkerId.charAt(0).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      {isAnimating && (
        <div 
          className="absolute inset-0 rounded-full border-2 border-t-accent border-r-transparent border-b-transparent border-l-transparent animate-spin"
          data-testid="avatar-spinner"
        />
      )}
    </div>
  );
}
