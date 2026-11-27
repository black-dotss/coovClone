import React from "react";

export interface ProgressBarProps {
  value: number; // 0 to 100
  max?: number;
  label?: string;
  showValue?: boolean;
  color?: "emerald" | "amber" | "rose" | "sky" | "purple";
  variant?: "primary" | "success" | "warning" | "danger" | "emerald" | "amber" | "rose" | "sky" | "purple";
  size?: "sm" | "md" | "lg";
  className?: string;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
  value,
  max = 100,
  label,
  showValue = false,
  color,
  variant,
  size = "md",
  className = "",
}) => {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100));

  const resolvedColor: "emerald" | "amber" | "rose" | "sky" | "purple" =
    variant === "primary"
      ? "purple"
      : variant === "success"
      ? "purple"
      : variant === "warning"
      ? "purple"
      : variant === "danger"
      ? "purple"
      : color || "purple";

  const colorStyles = {
    emerald: "bg-purple-600 dark:bg-purple-500",
    amber: "bg-purple-500 dark:bg-purple-400",
    rose: "bg-purple-700 dark:bg-purple-600",
    sky: "bg-purple-500",
    purple: "bg-purple-600 dark:bg-purple-500",
  };

  const sizeStyles = {
    sm: "h-1.5",
    md: "h-2.5",
    lg: "h-4",
  };

  return (
    <div className={`w-full flex flex-col gap-1.5 ${className}`}>
      {(label || showValue) && (
        <div className="flex justify-between items-center text-xs font-semibold text-text-secondary">
          {label && <span>{label}</span>}
          {showValue && <span className="font-mono text-text-muted">{Math.round(percentage)}%</span>}
        </div>
      )}
      <div className={`w-full bg-border/40 rounded-md overflow-hidden ${sizeStyles[size]}`}>
        <div
          className={`h-full rounded-md transition-all duration-500 ease-out ${colorStyles[resolvedColor]}`}
          style={{ width: `${percentage}%` }}
          role="progressbar"
          aria-valuenow={value}
          aria-valuemin={0}
          aria-valuemax={max}
        />
      </div>
    </div>
  );
};
