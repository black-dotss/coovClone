import React from "react";
import { InfinityLoop } from "@/components/loading-ui/infinity";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "outline" | "ghost" | "danger" | "glow";
  size?: "sm" | "md" | "lg";
  isLoading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className = "",
      variant = "primary",
      size = "md",
      isLoading = false,
      disabled,
      children,
      ...props
    },
    ref
  ) => {
    const baseStyles =
      "inline-flex items-center justify-center font-medium transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-offset-2 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none select-none rounded-lg cursor-pointer whitespace-nowrap shrink-0";

    const variantStyles = {
      primary:
        "bg-zinc-950 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200 shadow-xs border border-transparent font-semibold",
      glow:
        "bg-zinc-950 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200 border border-transparent font-semibold shadow-xs",
      secondary:
        "bg-zinc-100 text-zinc-900 hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800 border border-border shadow-xs",
      outline:
        "border border-border text-text bg-surface/50 hover:bg-surface-elevated hover:text-text focus:ring-zinc-400/30",
      ghost:
        "text-text-secondary bg-transparent hover:bg-surface-elevated hover:text-text focus:ring-zinc-400/30",
      danger:
        "bg-red-600 text-white hover:bg-red-500 active:bg-red-700 focus:ring-red-500 shadow-sm shadow-red-900/20",
    };

    const sizeStyles = {
      sm: "text-xs px-3 py-1.5 gap-1.5 font-medium",
      md: "text-sm px-4 py-2 gap-2 font-medium",
      lg: "text-base px-6 py-3 gap-2.5 font-semibold",
    };

    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={`${baseStyles} ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
        {...props}
      >
        {isLoading && (
          <InfinityLoop className="-ml-1 mr-2 w-4 h-3.5 text-current shrink-0" />
        )}
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";
