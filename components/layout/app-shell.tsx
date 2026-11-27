"use client";

import React from "react";

interface AppShellProps {
  children: React.ReactNode;
  title?: string;
  description?: string;
  action?: React.ReactNode;
  activeDeviceId?: string;
}

export const AppShell: React.FC<AppShellProps> = ({
  children,
  title,
  description,
  action,
}) => {
  return (
    <div className="w-full min-h-[calc(100vh-4.5rem)] flex flex-col">
      {/* Main Content Area - Single Nav, Clean & Spacious */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
        {(title || description) && (
          <div className="mb-8 pb-5 border-b border-border/80 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              {title && (
                <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-text">
                  {title}
                </h1>
              )}
              {description && (
                <p className="text-sm sm:text-base text-text-secondary mt-1.5">
                  {description}
                </p>
              )}
            </div>
            {action && (
              <div className="flex items-center gap-2.5 flex-wrap sm:flex-nowrap w-full sm:w-auto shrink-0">
                {action}
              </div>
            )}
          </div>
        )}
        {children}
      </main>
    </div>
  );
};
