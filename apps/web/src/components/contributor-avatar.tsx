"use client";

import { useState } from "react";

export function ContributorAvatar({
  name,
  avatar,
  size = "md",
  className = "",
}: {
  name: string;
  avatar?: string | null | undefined;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const [imageError, setImageError] = useState(false);

  const initials = name
    .split(" ")
    .map((n) => n[0])
    .filter(Boolean)
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const sizeClasses =
    size === "sm"
      ? "h-9 w-9 text-xs rounded-xl"
      : size === "lg"
      ? "h-14 w-14 text-base rounded-2xl"
      : "h-11 w-11 text-sm rounded-xl";

  if (avatar && !imageError) {
    return (
      <img
        src={avatar}
        alt={`${name}'s profile avatar`}
        onError={() => setImageError(true)}
        className={`${sizeClasses} shrink-0 object-cover border border-border/80 shadow-xs ${className}`}
        loading="lazy"
        referrerPolicy="no-referrer"
      />
    );
  }

  return (
    <div
      className={`bg-accent/15 text-accent flex ${sizeClasses} shrink-0 items-center justify-center font-mono font-bold shadow-xs border border-accent/25 ${className}`}
      aria-label={name}
    >
      {initials || "CR"}
    </div>
  );
}
