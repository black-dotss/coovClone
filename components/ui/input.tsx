import React from "react";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className = "", label, error, helperText, id, ...props }, ref) => {
    const inputId = id || props.name || Math.random().toString(36).substring(7);

    return (
      <div className="w-full flex flex-col gap-1.5">
        {label && (
          <label htmlFor={inputId} className="text-xs font-semibold text-text-secondary">
            {label}
          </label>
        )}
        <input
          id={inputId}
          ref={ref}
          className={`w-full rounded-xl border bg-surface/80 backdrop-blur-xs px-3.5 py-2 text-sm text-text placeholder:text-text-muted/60 transition-all focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary ${
            error
              ? "border-red-500/70 focus:ring-red-500/30 focus:border-red-500"
              : "border-border hover:border-border/80"
          } ${className}`}
          {...props}
        />
        {error && <p className="text-xs font-medium text-red-400">{error}</p>}
        {!error && helperText && <p className="text-xs text-text-muted">{helperText}</p>}
      </div>
    );
  }
);

Input.displayName = "Input";
