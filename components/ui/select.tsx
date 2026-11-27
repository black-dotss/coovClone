import React from "react";

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  helperText?: string;
  options?: Array<{ value: string; label: string }>;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className = "", label, error, helperText, id, options, children, ...props }, ref) => {
    const selectId = id || props.name || Math.random().toString(36).substring(7);

    return (
      <div className="w-full flex flex-col gap-1.5">
        {label && (
          <label htmlFor={selectId} className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {label}
          </label>
        )}
        <select
          id={selectId}
          ref={ref}
          className={`w-full rounded-lg border bg-white dark:bg-zinc-900 px-3.5 py-2 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition-colors ${
            error
              ? "border-red-500 focus:ring-red-500 focus:border-red-500"
              : "border-zinc-300 dark:border-zinc-700"
          } ${className}`}
          {...props}
        >
          {options
            ? options.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))
            : children}
        </select>
        {error && <p className="text-xs text-red-500">{error}</p>}
        {!error && helperText && <p className="text-xs text-zinc-500 dark:text-zinc-400">{helperText}</p>}
      </div>
    );
  }
);

Select.displayName = "Select";
