import React from "react";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className = "", label, error, helperText, id, rows = 4, ...props }, ref) => {
    const textareaId = id || props.name || Math.random().toString(36).substring(7);

    return (
      <div className="w-full flex flex-col gap-1.5">
        {label && (
          <label htmlFor={textareaId} className="text-xs font-semibold text-text-secondary">
            {label}
          </label>
        )}
        <textarea
          id={textareaId}
          ref={ref}
          rows={rows}
          className={`w-full rounded-xl border bg-surface/80 backdrop-blur-xs px-3.5 py-2.5 text-sm text-text placeholder:text-text-muted/60 transition-all focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary ${
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

Textarea.displayName = "Textarea";
