"use client";

import React, { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Application error:", error);
  }, [error]);

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center p-6 text-center space-y-4">
      <div className="w-12 h-12 rounded-2xl bg-purple-950/60 border border-purple-500/40 flex items-center justify-center text-purple-300 font-mono text-xl font-bold">
        !
      </div>
      <div className="space-y-1">
        <h2 className="text-xl font-bold text-white">Something went wrong</h2>
        <p className="text-xs text-text-secondary max-w-md">
          {error?.message || "An unexpected error occurred while rendering this page."}
        </p>
      </div>
      <Button variant="primary" onClick={() => reset()} className="text-xs font-semibold">
        Try Again
      </Button>
    </div>
  );
}
