import React from "react";

export interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "info" | "warning" | "danger" | "success";
  title?: string;
  action?: React.ReactNode;
}

export const Alert: React.FC<AlertProps> = ({
  variant = "info",
  title,
  action,
  children,
  className = "",
  ...props
}) => {
  const variantStyles = {
    info: "bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-900 text-blue-800 dark:text-blue-200",
    warning: "bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-200",
    danger: "bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900 text-red-800 dark:text-red-200",
    success: "bg-purple-50 dark:bg-purple-950/40 border-purple-200 dark:border-purple-900 text-purple-800 dark:text-purple-200",
  };

  return (
    <div
      role="alert"
      className={`rounded-xl border p-4 text-sm flex flex-col gap-1 ${variantStyles[variant]} ${className}`}
      {...props}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1 flex-1">
          {title && <h5 className="font-semibold text-sm leading-none tracking-tight">{title}</h5>}
          <div className="text-xs sm:text-sm leading-relaxed">{children}</div>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </div>
  );
};
