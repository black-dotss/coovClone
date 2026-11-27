import React from "react";

export const Card: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className = "",
  children,
  ...props
}) => (
  <div
    className={`bg-white dark:bg-zinc-900/90 border border-zinc-200/80 dark:border-zinc-800/80 rounded-2xl shadow-xs transition-all ${className}`}
    {...props}
  >
    {children}
  </div>
);

export const CardHeader: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className = "",
  children,
  ...props
}) => (
  <div className={`p-6 border-b border-zinc-100 dark:border-zinc-800/60 ${className}`} {...props}>
    {children}
  </div>
);

export const CardTitle: React.FC<React.HTMLAttributes<HTMLHeadingElement>> = ({
  className = "",
  children,
  ...props
}) => (
  <h3 className={`text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 ${className}`} {...props}>
    {children}
  </h3>
);

export const CardDescription: React.FC<React.HTMLAttributes<HTMLParagraphElement>> = ({
  className = "",
  children,
  ...props
}) => (
  <p className={`text-sm text-zinc-500 dark:text-zinc-400 mt-1 leading-relaxed ${className}`} {...props}>
    {children}
  </p>
);

export const CardContent: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className = "",
  children,
  ...props
}) => (
  <div className={`p-6 ${className}`} {...props}>
    {children}
  </div>
);

export const CardFooter: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className = "",
  children,
  ...props
}) => (
  <div
    className={`p-6 bg-zinc-50/50 dark:bg-zinc-950/30 border-t border-zinc-100 dark:border-zinc-800/60 flex items-center justify-between rounded-b-2xl ${className}`}
    {...props}
  >
    {children}
  </div>
);
