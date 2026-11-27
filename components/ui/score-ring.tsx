import React from "react";

export interface ScoreRingProps {
  score: number; // 0 to 100
  size?: number;
  strokeWidth?: number;
  label?: string;
  verdict?: string;
  className?: string;
}

export const ScoreRing: React.FC<ScoreRingProps> = ({
  score,
  size = 120,
  strokeWidth = 10,
  label = "Overall Score",
  verdict,
  className = "",
}) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const safeScore = Math.min(100, Math.max(0, score));
  const offset = circumference - (safeScore / 100) * circumference;

  let strokeColor = "#7C3AED"; // purple default
  if (safeScore >= 75) strokeColor = "#8B5CF6"; // vibrant purple
  else if (safeScore >= 55) strokeColor = "#A855F7"; // light purple

  return (
    <div className={`flex flex-col items-center justify-center ${className}`}>
      <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="rotate-[-90deg]">
          {/* Background Track */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke="currentColor"
            strokeWidth={strokeWidth}
            className="text-border/50"
            fill="transparent"
          />
          {/* Progress Arc */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            className="transition-all duration-1000 ease-out"
            fill="transparent"
          />
        </svg>

        {/* Center Text */}
        <div className="absolute flex flex-col items-center justify-center text-center">
          <span className="text-3xl font-bold font-mono text-text tracking-tight">
            {Math.round(safeScore)}
          </span>
          <span className="text-[10px] uppercase font-bold text-text-muted">/ 100</span>
        </div>
      </div>

      {verdict && (
        <span className="mt-3 text-sm font-bold text-text">
          {verdict}
        </span>
      )}
      {label && (
        <span className="text-xs text-text-muted mt-0.5 font-medium">
          {label}
        </span>
      )}
    </div>
  );
};
