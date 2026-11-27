import React from "react";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?:
    | "default"
    | "success"
    | "warning"
    | "danger"
    | "info"
    | "primary"
    | "purple"
    | "neutral"
    | "hr"
    | "tech"
    | "ats"
    | "manager"
    | "strategy"
    | "risk";
  size?: "sm" | "md";
  dot?: boolean;
}

export const Badge: React.FC<BadgeProps> = ({
  className = "",
  variant = "default",
  size = "md",
  dot = false,
  children,
  ...props
}) => {
  const variantStyles = {
    default: "bg-surface-elevated text-text border-border",
    primary: "bg-zinc-950 text-white dark:bg-white dark:text-zinc-950 border-transparent",
    purple: "bg-purple-100 text-purple-900 border-purple-200 dark:bg-purple-950/50 dark:text-purple-300 dark:border-purple-800/50",
    neutral: "bg-surface-elevated text-text-secondary border-border",
    success: "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/50",
    warning: "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/50",
    danger: "bg-red-50 text-red-800 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800/50",
    info: "bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800/50",
    // Agent Personas - streamlined accents
    hr: "bg-surface-elevated text-text border-border",
    tech: "bg-surface-elevated text-text border-border",
    ats: "bg-surface-elevated text-text border-border",
    manager: "bg-surface-elevated text-text border-border",
    strategy: "bg-surface-elevated text-text border-border",
    risk: "bg-red-50 text-red-800 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800/50",
  };

  const dotColors = {
    default: "bg-zinc-400",
    primary: "bg-zinc-950 dark:bg-white",
    purple: "bg-zinc-500",
    neutral: "bg-zinc-400",
    success: "bg-purple-500",
    warning: "bg-purple-400",
    danger: "bg-zinc-400",
    info: "bg-zinc-500",
    hr: "bg-zinc-400",
    tech: "bg-zinc-500",
    ats: "bg-zinc-500",
    manager: "bg-zinc-400",
    strategy: "bg-zinc-500",
    risk: "bg-red-500",
  };

  const sizeStyles = {
    sm: "text-[11px] px-2 py-0.5 font-medium",
    md: "text-xs px-2.5 py-1 font-medium",
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border tracking-tight ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
      {...props}
    >
      {dot && <span className={`w-1.5 h-1.5 rounded-xs ${dotColors[variant]}`} />}
      {children}
    </span>
  );
};
