import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import adlerImg from "../assets/thinkers/Adler_1770133537748.png";
import aesopImg from "../assets/thinkers/Aesop_1770133541338.png";
import dworkinImg from "../assets/thinkers/Andrea_Dworkin_1770133547246.png";
import aristotleImg from "../assets/thinkers/Aristotle_1770133547246.png";
import baconImg from "../assets/thinkers/Bacon_1770133547246.png";
import berglerImg from "../assets/thinkers/Bergler_1770133547246.png";
import bergsonImg from "../assets/thinkers/Bergson_1770133547246.png";
import berkeleyImg from "../assets/thinkers/Berkeley_1770133547246.png";
import confuciusImg from "../assets/thinkers/Confucius_1770133565512.png";
import darwinImg from "../assets/thinkers/Darwin_1770133565512.png";
import descartesImg from "../assets/thinkers/Descartes_1770133565512.png";
import deweyImg from "../assets/thinkers/Dewey_1770133565512.png";
import engelsImg from "../assets/thinkers/Engels_1770133565512.png";
import freudImg from "../assets/thinkers/Freud_1770133565512.png";

const THINKER_AVATARS: Record<string, string> = {
  adler: adlerImg,
  aesop: aesopImg,
  dworkin: dworkinImg,
  aristotle: aristotleImg,
  bacon: baconImg,
  bergler: berglerImg,
  bergson: bergsonImg,
  berkeley: berkeleyImg,
  confucius: confuciusImg,
  darwin: darwinImg,
  descartes: descartesImg,
  dewey: deweyImg,
  engels: engelsImg,
  freud: freudImg,
};

interface ThinkerAvatarProps {
  thinkerId: string;
  size?: "sm" | "md" | "lg" | "xl";
  isAnimating?: boolean;
  className?: string;
}

export function ThinkerAvatar({ thinkerId, size = "md", isAnimating = false, className = "" }: ThinkerAvatarProps) {
  const sizeClasses = {
    sm: "h-8 w-8",
    md: "h-12 w-12",
    lg: "h-16 w-16",
    xl: "h-24 w-24",
  };

  const avatarSrc = THINKER_AVATARS[thinkerId.toLowerCase()];

  return (
    <div className={`relative ${className}`}>
      <Avatar 
        className={`${sizeClasses[size]} border-2 border-primary shadow-lg ${isAnimating ? "animate-spin" : ""}`}
        style={{ animationDuration: isAnimating ? "3s" : undefined }}
        data-testid={`avatar-thinker-${thinkerId.toLowerCase()}`}
      >
        <AvatarImage src={avatarSrc} alt={thinkerId} className="object-cover" />
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

export function getThinkerAvatar(thinkerId: string): string | null {
  return THINKER_AVATARS[thinkerId.toLowerCase()] || null;
}
