"use client";

import React, { useState } from "react";

export type AgentRoleKey =
  | "hr_recruiter"
  | "technical_interviewer"
  | "ats_scanner"
  | "hiring_manager"
  | "career_strategist"
  | "red_flag_analyst";

export interface AvatarProps {
  role?: AgentRoleKey | "user";
  name?: string;
  image?: string;
  size?: "sm" | "md" | "lg" | "xl" | "2xl";
  className?: string;
}

export const AGENT_AVATARS: Record<AgentRoleKey, string> = {
  hr_recruiter: "/Agents_PP/HR.png",
  technical_interviewer: "/Agents_PP/Tech.png",
  ats_scanner: "/Agents_PP/Fuzzy ATS Resume Inspector Mascot.png",
  hiring_manager: "/Agents_PP/Stern Green Hiring Manager.png",
  career_strategist: "/Agents_PP/Confident Plush Career Strategist.png",
  red_flag_analyst: "/Agents_PP/Furry Red Flags Investigator.png",
};

/**
 * Preload all agent avatars into memory so they display instantly without layout shifts.
 */
export function preloadAgentAvatars(): void {
  if (typeof window === "undefined") return;
  Object.values(AGENT_AVATARS).forEach((src) => {
    const img = new Image();
    img.src = src;
  });
}

const AGENT_CONFIGS: Record<AgentRoleKey, { initials: string; bg: string; text: string; label: string }> = {
  hr_recruiter: {
    initials: "HR",
    bg: "bg-rose-950/60 border-rose-800/60",
    text: "text-rose-300",
    label: "HR Recruiter",
  },
  technical_interviewer: {
    initials: "DEV",
    bg: "bg-sky-950/60 border-sky-800/60",
    text: "text-sky-300",
    label: "Technical Interviewer",
  },
  ats_scanner: {
    initials: "ATS",
    bg: "bg-purple-950/60 border-purple-800/60",
    text: "text-purple-300",
    label: "ATS Scanner",
  },
  hiring_manager: {
    initials: "HM",
    bg: "bg-emerald-950/60 border-emerald-800/60",
    text: "text-emerald-300",
    label: "Hiring Manager",
  },
  career_strategist: {
    initials: "CS",
    bg: "bg-amber-950/60 border-amber-800/60",
    text: "text-amber-300",
    label: "Career Strategist",
  },
  red_flag_analyst: {
    initials: "RED",
    bg: "bg-red-950/60 border-red-800/60",
    text: "text-red-300",
    label: "Red Flag Analyst",
  },
};

export const Avatar: React.FC<AvatarProps> = ({
  role = "user",
  name,
  image,
  size = "md",
  className = "",
}) => {
  const [prevImage, setPrevImage] = useState(image);
  const [imageError, setImageError] = useState(false);

  // Reset imageError when image prop changes during render
  if (prevImage !== image) {
    setPrevImage(image);
    setImageError(false);
  }

  const sizeStyles = {
    sm: "w-8 h-8 text-[11px]",
    md: "w-10 h-10 text-xs",
    lg: "w-12 h-12 text-sm",
    xl: "w-16 h-16 text-base",
    "2xl": "w-20 h-20 text-lg",
  };

  if (role !== "user" && role in AGENT_CONFIGS) {
    const config = AGENT_CONFIGS[role as AgentRoleKey];
    const avatarSrc = image || AGENT_AVATARS[role as AgentRoleKey];

    if (avatarSrc && !imageError) {
      return (
        <div
          title={config.label}
          className={`relative overflow-hidden select-none shrink-0 bg-zinc-900 border border-zinc-800 ${sizeStyles[size]} ${className}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={avatarSrc}
            alt={config.label}
            className="w-full h-full object-cover object-center"
            onError={() => setImageError(true)}
            referrerPolicy="no-referrer"
          />
        </div>
      );
    }

    return (
      <div
        title={config.label}
        className={`flex items-center justify-center font-bold select-none border ${config.bg} ${config.text} ${sizeStyles[size]} ${className}`}
      >
        {config.initials}
      </div>
    );
  }

  // User Avatar
  const userInitials = name
    ? name
        .trim()
        .split(/\s+/)
        .map((p) => p[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "U";

  return (
    <div
      title={name || "User"}
      className={`flex items-center justify-center font-semibold bg-purple-950/70 text-purple-300 border border-purple-800/60 select-none overflow-hidden shrink-0 ${sizeStyles[size]} ${className}`}
    >
      {image && !imageError ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image}
          alt={name || "User"}
          className="w-full h-full object-cover"
          onError={() => setImageError(true)}
          referrerPolicy="no-referrer"
        />
      ) : (
        <span className="font-bold">{userInitials}</span>
      )}
    </div>
  );
};
